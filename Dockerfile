FROM node:20-bookworm-slim

# LibreOffice: Office <-> PDF. Ghostscript: compress. qpdf: protect/unlock/repair.
# Python: PDF -> Word (pdf2docx) and PDF -> Excel (pdfplumber).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    ghostscript \
    qpdf \
    python3 \
    python3-venv \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY converters/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/pyenv \
    && /opt/pyenv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
ENV PYTHON_BIN=/opt/pyenv/bin/python

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js seo.js guides.js ./
COPY guides ./guides
COPY converters ./converters
COPY public ./public

# Accounts, sessions and usage counters. Mount a volume here, or every
# redeploy deletes all user accounts:  -v /opt/letsconvertpdf/data:/app/data
ENV DATA_DIR=/app/data
VOLUME /app/data

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
