import sys
import os
from Compressor import Compressor

if __name__ == "__main__":
    action = sys.argv[1]
    
    repo_root = os.path.dirname(os.path.abspath(__file__))
    
    compressor = Compressor(
        i_model=os.path.join(repo_root, "models/cvpr2025_image.pth.tar"),
        p_model=os.path.join(repo_root, "models/cvpr2025_video.pth.tar"),
        device="cuda"
    )
    if action == "compress":
        compressor.compress(sys.argv[2], int(sys.argv[3]))
    elif action == "decompress":
        compressor.decompress(sys.argv[2], sys.argv[3])
