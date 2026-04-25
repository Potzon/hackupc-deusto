import torch
from diffusers import AutoencoderKL, AutoencoderTiny
from PIL import Image
import numpy as np
import argparse
import time

class CustomAutoencoderKL:
    MODEL_PRESETS = {
        "sd15-mse": "stabilityai/sd-vae-ft-mse",
        "sdxl-fp16": "madebyollin/sdxl-vae-fp16-fix",
        "taesd-fast": "madebyollin/taesd",
    }

    def __init__(self, image_path: str, model_key: str):

        self.image_path = image_path

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

    def preprocess_image(self):

        image = Image.open(self.image_path).convert("RGB")
            
        w, h = image.size
        print(f"Original image size: {w}x{h}")

        #w, h = int(w/2), int(h/2)
        #print(f"Original transformed size: {w}x{h}")
        
        # modificar w y h para que sean múltiplos de 8, 
        # la segunda multiflicación afecta a la calidad de la imagen,
        # idealmente 8 es el valor mínimo para evitar distorsiones
        # se puede ajustar para aumentar velocidad en inferencia

        w = (w // 8) * 8
        h = (h // 8) * 8
        image = image.resize((w, h)) 
        print(f"Resized image size: {w}x{h}") 
        image_np = np.array(image).astype(np.float32) / 255.0
        image_np = (image_np * 2.0) - 1.0  # scale to [-1, 1]
        image_tensor = torch.tensor(image_np, dtype=self.dtype).permute(2, 0, 1).unsqueeze(0).to(self.device)
        
        print("Input tensor shape:", image_tensor.shape)
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
        
        print("Latent shape:", latents.shape)

        return latents

    def decode(self, latents):
        with torch.inference_mode():
            decoded = self.vae.decode(latents / self.scaling_factor).sample
        return decoded

    def postprocess_and_save(self, decoded):
        decoded = (decoded / 2 + 0.5).clamp(0, 1)
        decoded = decoded.cpu().permute(0, 2, 3, 1).numpy()[0]
        decoded = (decoded * 255).astype(np.uint8)

        Image.fromarray(decoded).save(f"{self.image_path}".replace(".png", "_decoded.png"))

    def _sync_device(self):
        if self.device == "cuda":
            torch.cuda.synchronize()

    def run(self):
        image_tensor = self.preprocess_image()

        self._sync_device()
        t0 = time.perf_counter()
        latents = self.encode(image_tensor)
        self._sync_device()
        encode_ms = (time.perf_counter() - t0) * 1000.0

        self._sync_device()
        t1 = time.perf_counter()
        decoded = self.decode(latents)
        self._sync_device()
        decode_ms = (time.perf_counter() - t1) * 1000.0

        print(f"Encode time: {encode_ms:.2f} ms")
        print(f"Decode time: {decode_ms:.2f} ms")
        print("Decoded shape:", decoded.shape)
        self.postprocess_and_save(decoded)

def main():
    parser = argparse.ArgumentParser(description="Test VAE encoding and decoding")
    parser.add_argument("--input", type=str, default="./image_script/gato.png")
    parser.add_argument(
        "--model",
        type=str,
        default="taesd-fast",
        choices=list(CustomAutoencoderKL.MODEL_PRESETS.keys()),
        help="VAE preset: taesd-fast (fastest), sdxl-fp16 (newer/better), sd15-mse (baseline)",
    )

    args = parser.parse_args()

    input_image_path = args.input
    model_key = args.model

    image_encoder = CustomAutoencoderKL(input_image_path, model_key)
    image_encoder.run()

if __name__ == "__main__":
    main()

# usage example:
# python image_vae.py --input gato.png --model taesd-fast

"""
python image_vae.py --input gato.png --model taesd-fast
python image_vae.py --input gato.png --model sdxl-fp16
python image_vae.py --input gato.png --model sd15-mse
"""