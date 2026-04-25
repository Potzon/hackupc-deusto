import sys
from Compressor import Compressor

if __name__ == "__main__":
    action = sys.argv[1]
    compressor = Compressor(
        i_model="models/cvpr2025_image.pth.tar",
        p_model="models/cvpr2025_video.pth.tar",
        device="cuda"
    )
    if action == "compress":
        compressor.compress(sys.argv[2], int(sys.argv[3]))
    elif action == "decompress":
        compressor.decompress(sys.argv[2], sys.argv[3])
