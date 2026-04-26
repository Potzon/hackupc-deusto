import sys
import os
from Compressor import Compressor

if __name__ == "__main__":
    action = sys.argv[1]
    
    repo_root = os.path.dirname(os.path.abspath(__file__))
    
    i_model = sys.argv[4] if len(sys.argv) > 4 else os.path.join(repo_root, "models/cvpr2025_image.pth.tar")
    p_model = sys.argv[5] if len(sys.argv) > 5 else os.path.join(repo_root, "models/cvpr2025_video.pth.tar")

    compressor = Compressor(
        i_model=i_model,
        p_model=p_model,
        device="cuda"
    )
    if action == "compress":
        compressor.compress(sys.argv[2], int(sys.argv[3]))
    elif action == "decompress":
        compressor.decompress(sys.argv[2], sys.argv[3])
