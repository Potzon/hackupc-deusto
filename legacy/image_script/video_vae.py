import torch
from diffusers import AutoencoderKL, AutoencoderTiny
from PIL import Image
import numpy as np
import argparse
import cv2
import time

class CustomAutoencoderKL:
    MODEL_PRESETS = {
        "sd15-mse": "stabilityai/sd-vae-ft-mse",
        "sdxl-fp16": "madebyollin/sdxl-vae-fp16-fix",
        "taesd-fast": "madebyollin/taesd",
    }

    def __init__(self, video_path: str, model_key: str, frame_step: int = 1, batch_size: int = 8):

        self.video_path = video_path
        self.frame_step = frame_step
        self.batch_size = batch_size

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if self.device == "cuda" else torch.float32

        model_id = self.MODEL_PRESETS[model_key]
        if model_key == "taesd-fast":
            self.vae = AutoencoderTiny.from_pretrained(model_id, torch_dtype=self.dtype)
        elif model_key in ["sd15-mse", "sdxl-fp16"]:
            self.vae = AutoencoderKL.from_pretrained(model_id, torch_dtype=self.dtype)

        self.vae.eval()
        self.vae.to(self.device)
        self.scaling_factor = getattr(self.vae.config, "scaling_factor", 1.0)

        print(f"Using model: {model_id}")
        print(f"Device: {self.device}, dtype: {self.dtype}")

    @staticmethod
    def tensor_size_mb(tensor):
        """Calculate tensor size in MB."""
        return tensor.element_size() * tensor.nelement() / (1024 ** 2)

    def image_size_mb(self, image):
        """Calculate image size in MB."""
        return image.nbytes / (1024 ** 2)

    def preprocess_frame(self, frame_bgr):
        image = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        w, h = image.size

        # modificar w y h para que sean múltiplos de 8, 
        w = (w // 8) * 8
        h = (h // 8) * 8
        image = image.resize((w, h)) 

        image_np = np.array(image).astype(np.float32) / 255.0
        image_np = (image_np * 2.0) - 1.0  # scale to [-1, 1]
        print(f"  original frame: {self.image_size_mb(image_np):.2f} MB")
        image_tensor = torch.tensor(image_np, dtype=self.dtype).permute(2, 0, 1).unsqueeze(0).to(self.device)
        print(f"  image_tensor: {self.tensor_size_mb(image_tensor):.2f} MB")
        
        return image_tensor

    def encode(self, image_tensor):
        with torch.inference_mode():
            encoded = self.vae.encode(image_tensor)
            if hasattr(encoded, "latent_dist"):
                # KL VAEs expose a distribution.
                latents = encoded.latent_dist.sample()
            else:
                # Tiny VAEs expose latents directly.
                latents = encoded.latents
        latents = latents * self.scaling_factor
        print(f"  latents: {self.tensor_size_mb(latents):.2f} MB")

        return latents

    def decode(self, latents):
        with torch.inference_mode():
            decoded = self.vae.decode(latents / self.scaling_factor).sample
        print(f"  decoded: {self.tensor_size_mb(decoded):.2f} MB")
        return decoded

    def postprocess_frame(self, decoded):
        decoded = (decoded / 2 + 0.5).clamp(0, 1)
        decoded = decoded.cpu().permute(0, 2, 3, 1).numpy()[0]
        decoded = (decoded * 255).astype(np.uint8)
        
        # Convert back to BGR for OpenCV
        frame_bgr = cv2.cvtColor(decoded, cv2.COLOR_RGB2BGR)
        print(f"  postprocessed frame: {self.image_size_mb(frame_bgr):.2f} MB")
        return frame_bgr

    def _sync_device(self):
        if self.device == "cuda":
            torch.cuda.synchronize()
            
    def _process_batch(self, batch_tensors, out_writer):
        batch_tensor = torch.cat(batch_tensors, dim=0)
        latents = self.encode(batch_tensor)
        decoded_batch = self.decode(latents)
        
        for i in range(decoded_batch.shape[0]):
            out_frame = self.postprocess_frame(decoded_batch[i:i+1])
            out_writer.write(out_frame)

    def process_video(self):
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            print(f"Error opening video file: {self.video_path}")
            return

        fps = cap.get(cv2.CAP_PROP_FPS)
        orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        # Calculate new dimensions (multiples of 8)
        new_w = (orig_w // 8) * 8
        new_h = (orig_h // 8) * 8
        
        # Adjust output FPS so the video plays at normal speed despite skipped frames
        out_fps = fps / self.frame_step if self.frame_step > 0 else fps
        
        output_path = self.video_path.rsplit('.', 1)[0] + "_decoded.mp4"
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, out_fps, (new_w, new_h))
        
        frame_idx = 0
        processed_count = 0
        batch_tensors = []
        
        print(f"Starting processing: {orig_w}x{orig_h} -> {new_w}x{new_h} @ {out_fps} FPS")
        t0 = time.perf_counter()
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Only process 1 frame every self.frame_step frames
            if frame_idx % self.frame_step == 0:
                image_tensor = self.preprocess_frame(frame)
                batch_tensors.append(image_tensor)
                
                if len(batch_tensors) == self.batch_size:
                    self._process_batch(batch_tensors, out)
                    processed_count += len(batch_tensors)
                    batch_tensors = []
                    print(f"Processed {processed_count} frames...")
                
            frame_idx += 1
            
        # Process any remaining frames in the last partial batch
        if len(batch_tensors) > 0:
            self._process_batch(batch_tensors, out)
            processed_count += len(batch_tensors)
            
        total_time = time.perf_counter() - t0
        print(f"Finished! Processed {processed_count} frames in {total_time:.2f}s")
        print(f"Saved video to: {output_path}")
        
        cap.release()
        out.release()

def main():
    parser = argparse.ArgumentParser(description="Test VAE encoding and decoding")
    parser.add_argument("--input", type=str, default="video.mp4")
    parser.add_argument(
        "--model",
        type=str,
        default="taesd-fast",
        choices=list(CustomAutoencoderKL.MODEL_PRESETS.keys()),
        help="VAE preset: taesd-fast (fastest), sdxl-fp16 (newer/better), sd15-mse (baseline)",
    )
    parser.add_argument("--frame_step", type=int, default=1, help="Process 1 every N frames. Use 1 to process all frames.")
    parser.add_argument("--batch_size", type=int, default=30, help="Number of frames to process in a batch.")

    args = parser.parse_args()

    input_image_path = args.input
    model_key = args.model
    frame_step = args.frame_step
    batch_size = args.batch_size

    video_encoder = CustomAutoencoderKL(input_image_path, model_key, frame_step, batch_size)
    video_encoder.process_video()

if __name__ == "__main__":
    main()

"""
usage examples:

python image_script/video_vae.py --input image_script/video.mp4 --model taesd-fast --frame_step 3 --batch_size 30
python image_script/video_vae.py --input image_script/video.mp4 --model sd15-mse --frame_step 3 --batch_size 30
python image_script/video_vae.py --input image_script/video.mp4 --model sdxl-fp16 --frame_step 3 --batch_size 30
"""