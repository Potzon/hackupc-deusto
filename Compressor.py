import shutil
import subprocess
import sys
from pathlib import Path
import cProfile
import pstats
import time
class Compressor:
    def __init__(self, i_model:str, p_model:str, device):
        self.i_model = i_model
        self.p_model = p_model
        self.device = device

    def compress(self, input_video_path: str, frames: int):
        repo_root = Path(__file__).resolve().parent
        frames_dir = repo_root / "DCVC" / "local_data" / "demo" / "test_video_frames"

        frames_dir.mkdir(parents=True, exist_ok=True)
        for entry in frames_dir.iterdir():
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()

        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path is None:
            raise RuntimeError("ffmpeg is required to extract frames but was not found in PATH")

        extract_cmd = [
            ffmpeg_path,
            "-y",
            "-i",
            input_video_path,
            str(frames_dir / "im%05d.png"),
        ]
        subprocess.run(extract_cmd, check=True, cwd=repo_root)

        python_exec = sys.executable if sys.executable else "python3"
        compress_cmd = [
            python_exec,
            "DCVC/test_video.py",
            "--test_config",
            "DCVC/configs/test_video_single.json",
            "--output_path",
            "DCVC/results/test_video_metrics_smoke.json",
            "--model_path_i",
            self.i_model,
            "--model_path_p",
            self.p_model,
            "--rate_num",
            "1",
            "--qp_i",
            "3",
            "--qp_p",
            "3",
            "--write_stream",
            "true",
            "--stream_path",
            "out_bin",
            "--save_decoded_frame",
            "False",
            "--check_existing",
            "false",
            "--worker",
            "1",
            "--cuda",
            "true" if self.device == "cuda" else "false",
            "--force_frame_num",
            str(frames),
        ]
        subprocess.run(compress_cmd, check=True, cwd=repo_root)
    
    def decompress(self, input_stream_path: str, output_video_path: str, max_frames: int = -1):
        repo_root = Path(__file__).resolve().parent
        python_exec = sys.executable if sys.executable else "python3"

        bin_path = Path(input_stream_path)
        if not bin_path.is_absolute():
            bin_path = repo_root / bin_path

        output_mp4 = Path(output_video_path)
        if not output_mp4.is_absolute():
            output_mp4 = repo_root / output_mp4

        # Store decoded PNGs next to the target MP4.
        output_dir = output_mp4.parent / f"{output_mp4.stem}_frames"

        decode_cmd = [
            python_exec,
            "DCVC/decode_bin.py",
            "--bin_path",
            str(bin_path),
            "--model_path_i",
            self.i_model,
            "--model_path_p",
            self.p_model,
            "--output_dir",
            str(output_dir),
            "--max_frames",
            str(max_frames),
            "--output_mp4",
            str(output_mp4),
            "--fps",
            "29.97",
            "--cuda",
            "true" if self.device == "cuda" else "false",
        ]
        subprocess.run(decode_cmd, check=True, cwd=repo_root)

if __name__ == "__main__":
    compressor = Compressor(
        i_model="models/cvpr2025_image.pth.tar",
        p_model="models/cvpr2025_video.pth.tar",
        device="cuda"
    )
    profiler = cProfile.Profile()

    profiler.enable()

    start = time.time()
    compressor.compress("video.mp4", frames=4211)
    end = time.time()
    print(f"Compression took {end - start:.2f} seconds")

    start = time.time()
    compressor.decompress(
        "out_bin/MP4_DEMO/test_video_frames_q3.bin",
        "decompressed_video.mp4"
    )
    end = time.time()
    print(f"Decompression took {end - start:.2f} seconds")

    profiler.disable()

    stats = pstats.Stats(profiler)
    stats.strip_dirs()
    stats.sort_stats("cumtime")
    stats.print_stats(40)