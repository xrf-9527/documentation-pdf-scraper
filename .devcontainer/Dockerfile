FROM mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm

ARG TZ
ENV TZ="$TZ"
ENV DEBIAN_FRONTEND=noninteractive
ENV UV_LINK_MODE=copy

USER root

# Install the project-specific toolchain:
# - Pandoc + XeLaTeX + fonts for PDF generation
# - Python + uv for merge scripts and local tooling
# - Chrome runtime libraries for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  fontconfig \
  fonts-liberation \
  fonts-noto-cjk \
  fonts-noto-core \
  fonts-noto-mono \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lmodern \
  make \
  pandoc \
  python3 \
  python3-pip \
  python3-venv \
  texlive-fonts-recommended \
  texlive-lang-chinese \
  texlive-latex-extra \
  texlive-plain-generic \
  texlive-xetex \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

# Install uv via the official installer so `make install` works in the container.
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

USER node
WORKDIR /workspace
