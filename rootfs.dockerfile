# syntax=docker.io/docker/dockerfile:1.4
ARG ADMIN_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ARG CARTESAPP_VERSION=1.3.0
ARG CARTESAPPLIB_VERSION=0.2.1
ARG BASE_IMAGE=cartesapp # base

ARG IMAGE_NAME=riscv64/python
ARG IMAGE_TAG=3.12.12-alpine3.22
# ARG IMAGE_TAG=3.13.11-alpine3.22
ARG MACHINE_GUEST_TOOLS_VERSION=0.17.1-r1

ARG CARTESAPP_ROOTFS_IMAGE=ghcr.io/prototyp3-dev/cartesapp-rootfs
ARG CARTESAPP_ROOTFS_VERSION=${CARTESAPP_VERSION}
FROM --platform=linux/riscv64 ${CARTESAPP_ROOTFS_IMAGE}:${CARTESAPP_ROOTFS_VERSION} AS state-builder

WORKDIR /opt/state

COPY cim/settings.py .

COPY <<EOF /opt/state/build_state.py
from cartesapplib.ledger.utils import initialize_ledger
from settings import LEDGER_CONFIG

LEDGER_CONFIG["mem_file"] = "state.bin"
initialize_ledger(LEDGER_CONFIG)
EOF

ENV PYTHONPATH="${PYTHONPATH}:/opt/python_libs"

RUN /usr/local/bin/python3 build_state.py

FROM --platform=linux/riscv64 scratch AS state

COPY --from=state-builder /opt/state/state.bin /

FROM --platform=linux/riscv64 ghcr.io/prototyp3-dev/cartesapp-rootfs:${CARTESAPP_VERSION} as cartesapp

FROM ${IMAGE_NAME}:${IMAGE_TAG} AS base

RUN <<EOF
set -e
apk update
apk add --no-interactive \
    gcompat=1.1.0-r4 sqlite=3.49.2-r1
EOF


# Install tools
ARG MACHINE_GUEST_TOOLS_VERSION
ADD --chmod=644 https://edubart.github.io/linux-packages/apk/keys/cartesi-apk-key.rsa.pub /etc/apk/keys/cartesi-apk-key.rsa.pub
RUN echo "https://edubart.github.io/linux-packages/apk/stable" >> /etc/apk/repositories
RUN apk update && apk add cartesi-machine-guest-tools=$MACHINE_GUEST_TOOLS_VERSION

# RUN <<EOF
# set -e
# apk update
# apk add openblas
# EOF


FROM ${BASE_IMAGE} AS deps

# Install dependencies
COPY custom-requirements.txt .
RUN <<EOF
set -e
pip install -r custom-requirements.txt --no-cache
EOF

FROM deps AS buildenv

RUN <<EOF
set -e
apk update
apk add --no-interactive \
    busybox-static=1.37.0-r20 git=2.49.1-r0 \
    libffi-dev=3.4.8-r0 build-base=0.5-r3 patchelf=0.18.0-r3
EOF
# gcc=14.2.0-r4

# RUN pip install --upgrade pip wheel build

ARG NUITKA_VERSION=4.0.6
ARG ZSTANDARD_VERSION=0.25.0
RUN pip install nuitka[onefile]==${NUITKA_VERSION} zstandard==${ZSTANDARD_VERSION} --find-links https://prototyp3-dev.github.io/pip-wheels-riscv/wheels/

ARG CARTESAPP_VERSION
ARG CARTESAPPLIB_VERSION
RUN pip install cartesapp[machine,machine-asset]@git+https://github.com/prototyp3-dev/cartesapp@v${CARTESAPP_VERSION} --find-links https://prototyp3-dev.github.io/pip-wheels-riscv/wheels/
RUN pip install cartesapplib@git+https://github.com/prototyp3-dev/cartesapplib@v${CARTESAPPLIB_VERSION} --find-links https://prototyp3-dev.github.io/pip-wheels-riscv/wheels/

# COPY cim/ /opt/cim/cim/
# COPY app.py /opt/cim/app.py

FROM buildenv AS builder

ENV PYTHONPATH="/usr/local/lib/python3.12/:/usr/local/lib/python3.12/site-packages:${PYTHONPATH}"
ENV NUITKA_CACHE_DIR=/opt/nuitka-cache
RUN python3 -m nuitka --python-flag=no_asserts --python-flag=dont_write_bytecode \
    --lto=yes  --output-dir=/opt/cim-dist --onefile --plugin-enable=pylint-warnings \
    /usr/local/bin/run_cartesapp
# --mode=standalone --follow-imports / --onefile / --include-package=cim

FROM base AS dist

COPY --from=builder /opt/cim-dist/ /opt/cim-dist
# COPY --from=builder /opt/cim-dist/app.dist/ /usr/local/cim-app
# RUN ln -s /usr/local/cim-app/app.bin /usr/local/bin/run_cim

FROM cimroot AS cimroot

FROM deps AS rootfs
# Clean
RUN <<EOF
set -e
find /usr/local/lib -type d -name __pycache__ -exec rm -r {} +
rm -rf /var/cache/apk /var/log/* /var/cache/* /tmp/*
EOF
