import argparse
import io
import os
import shutil
import subprocess
from typing import Optional

import numpy as np
import torch
from PIL import Image

from src.models.image_model import DMCI
from src.models.video_model import DMC
from src.utils.common import get_state_dict, set_torch_env, str2bool
from src.utils.stream_helper import SPSHelper, NalType, read_header, read_sps_remaining, read_ip_remaining
from src.utils.transforms import ycbcr2rgb


def parse_args():
    parser = argparse.ArgumentParser(description="Decode a DCVC .bin stream to frames or MP4")
    parser.add_argument("--bin_path", type=str, required=True)
    parser.add_argument("--model_path_i", type=str, required=True)
    parser.add_argument("--model_path_p", type=str, required=True)
    parser.add_argument("--output_dir", type=str, default="decoded_frames")
    parser.add_argument("--output_mp4", type=str, default=None)
    parser.add_argument("--save_png", type=str2bool, default=True)
    parser.add_argument("--png_compress_level", type=int, default=1)
    parser.add_argument("--stream_mp4", type=str2bool, default=False)
    parser.add_argument("--ffmpeg_preset", type=str, default="veryfast")
    parser.add_argument("--fps", type=float, default=29.97)
    parser.add_argument("--max_frames", type=int, default=-1)
    parser.add_argument("--force_zero_thres", type=float, default=None)
    parser.add_argument("--cuda", type=str2bool, default=True)
    parser.add_argument("--cuda_idx", type=int, default=0)
    return parser.parse_args()


def get_device(args):
    if args.cuda and torch.cuda.is_available():
        if args.cuda_idx is not None:
            os.environ["CUDA_VISIBLE_DEVICES"] = str(args.cuda_idx)
        return "cuda:0"
    return "cpu"


def load_models(device, model_path_i, model_path_p, force_zero_thres):
    i_frame_net = DMCI()
    i_state_dict = get_state_dict(model_path_i)
    i_frame_net.load_state_dict(i_state_dict)
    i_frame_net = i_frame_net.to(device).eval()
    i_frame_net.update(force_zero_thres)
    i_frame_net.half()

    p_frame_net = DMC()
    p_state_dict = get_state_dict(model_path_p)
    p_frame_net.load_state_dict(p_state_dict)
    p_frame_net = p_frame_net.to(device).eval()
    p_frame_net.update(force_zero_thres)
    p_frame_net.half()

    if device.startswith("cuda"):
        i_frame_net.half()
        p_frame_net.half()

    return i_frame_net, p_frame_net


def tensor_to_rgb8(x):
    rgb_rec = ycbcr2rgb(x)
    rgb_rec = torch.clamp(rgb_rec * 255, 0, 255).round().to(dtype=torch.uint8)
    rgb_rec = rgb_rec.squeeze(0).cpu().numpy().transpose(1, 2, 0)
    return rgb_rec


def save_png(rgb_np, out_path, compress_level):
    Image.fromarray(rgb_np.astype(np.uint8), "RGB").save(
        out_path,
        compress_level=max(0, min(9, int(compress_level))),
    )


def start_mp4_stream(output_mp4, fps, width, height, ffmpeg_preset):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required for --stream_mp4 but was not found in PATH")

    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s:v",
        f"{width}x{height}",
        "-r",
        str(fps),
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        ffmpeg_preset,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        output_mp4,
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def decode_stream(args, i_frame_net, p_frame_net):
    with open(args.bin_path, "rb") as f:
        input_buff = io.BytesIO(f.read())

    if args.save_png:
        os.makedirs(args.output_dir, exist_ok=True)

    sps_helper = SPSHelper()
    p_frame_net.set_curr_poc(0)
    mp4_proc: Optional[subprocess.Popen] = None

    frame_idx = 0
    reached_eof = False
    with torch.inference_mode():
        while True:
            if args.max_frames > 0 and frame_idx >= args.max_frames:
                break

            marker = input_buff.read(1)
            if len(marker) == 0:
                break
            input_buff.seek(-1, io.SEEK_CUR)

            try:
                header = read_header(input_buff)
            except Exception:
                break

            while header["nal_type"] == NalType.NAL_SPS:
                sps = read_sps_remaining(input_buff, header["sps_id"])
                sps_helper.add_sps_by_id(sps)
                marker = input_buff.read(1)
                if len(marker) == 0:
                    reached_eof = True
                    break
                input_buff.seek(-1, io.SEEK_CUR)
                header = read_header(input_buff)

            if reached_eof:
                break

            sps = sps_helper.get_sps_by_id(header["sps_id"])
            if sps is None:
                raise RuntimeError(f"SPS id {header['sps_id']} was not found in stream")

            qp, bit_stream = read_ip_remaining(input_buff)

            if header["nal_type"] == NalType.NAL_I:
                decoded = i_frame_net.decompress(bit_stream, sps, qp)
                p_frame_net.clear_dpb()
                p_frame_net.add_ref_frame(None, decoded["x_hat"])
            elif header["nal_type"] == NalType.NAL_P:
                if sps["use_ada_i"]:
                    p_frame_net.reset_ref_feature()
                decoded = p_frame_net.decompress(bit_stream, sps, qp)
            else:
                raise RuntimeError(f"Unsupported NAL type in stream: {header['nal_type']}")

            x_hat = decoded["x_hat"][:, :, :sps["height"], :sps["width"]]
            rgb_np = tensor_to_rgb8(x_hat)

            if args.stream_mp4:
                if mp4_proc is None:
                    mp4_proc = start_mp4_stream(
                        args.output_mp4,
                        args.fps,
                        sps["width"],
                        sps["height"],
                        args.ffmpeg_preset,
                    )
                if mp4_proc.stdin is None:
                    raise RuntimeError("ffmpeg stdin is not available for streaming")
                mp4_proc.stdin.write(np.ascontiguousarray(rgb_np).tobytes())

            frame_idx += 1
            if args.save_png:
                frame_name = os.path.join(args.output_dir, f"im{frame_idx:05d}.png")
                save_png(rgb_np, frame_name, args.png_compress_level)

    if mp4_proc is not None:
        mp4_proc.stdin.close()
        ret = mp4_proc.wait()
        if ret != 0:
            raise RuntimeError(f"ffmpeg streaming process failed with exit code {ret}")

    return frame_idx


def export_mp4(output_dir, fps, output_mp4):
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to export MP4 but was not found in PATH")

    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        os.path.join(output_dir, "im%05d.png"),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        output_mp4,
    ]
    subprocess.run(cmd, check=True)


def main():
    args = parse_args()
    set_torch_env()

    if args.stream_mp4 and not args.output_mp4:
        raise ValueError("--stream_mp4 requires --output_mp4")
    if not args.save_png and not (args.output_mp4 and args.stream_mp4):
        raise ValueError("No output selected. Use --save_png True or --output_mp4 with --stream_mp4 True")
    if args.stream_mp4 and args.max_frames > 0:
        print("warning: --stream_mp4 with --max_frames outputs only the decoded subset")

    device = get_device(args)
    print(f"device: {device}")

    if device.startswith("cuda"):
        torch.backends.cudnn.benchmark = True

    i_frame_net, p_frame_net = load_models(
        device,
        args.model_path_i,
        args.model_path_p,
        args.force_zero_thres,
    )

    decoded_frames = decode_stream(args, i_frame_net, p_frame_net)
    print(f"decoded frames: {decoded_frames}")
    if args.save_png:
        print(f"decoded PNGs: {args.output_dir}")

    if args.output_mp4 and decoded_frames > 0 and not args.stream_mp4:
        export_mp4(args.output_dir, args.fps, args.output_mp4)
        print(f"decoded MP4: {args.output_mp4}")
    elif args.output_mp4 and decoded_frames > 0 and args.stream_mp4:
        print(f"decoded MP4: {args.output_mp4}")


if __name__ == "__main__":
    main()
