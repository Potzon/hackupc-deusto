FROM pytorch/pytorch:2.2.1-cuda11.8-cudnn8-runtime

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

COPY DCVC/requirements.txt /app/DCVC/requirements.txt
RUN pip install --no-cache-dir -r DCVC/requirements.txt || true
RUN pip install --no-cache-dir bd-metric pybind11 einops fvcore

COPY . /app

ENTRYPOINT ["python", "cli.py"]
