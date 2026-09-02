# Builds the simulator from source. Normally driven by build-simulator.mjs.
# This image is amd64 only, so the platform should be passed at build time:
#   docker build --platform linux/amd64 --build-arg SIMULATOR_REF=v0.1.14 \
#     -f build-scripts/simulator/Dockerfile build-scripts/simulator
FROM emscripten/emsdk:3.1.25

# Required, build-simulator.mjs holds the version added via CLI arg.
ARG SIMULATOR_REF

# emsdk 3.1.25 bundles node 14 / npm 6, which cannot read this repo's lockfileVersion 3
ARG NODE_VERSION=20.18.1
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" \
	| tar -xz -C /usr/local --strip-components=1
ENV PATH="/usr/local/bin:${PATH}"

WORKDIR /src
RUN git clone --depth 1 --branch "${SIMULATOR_REF}" \
	https://github.com/microbit-foundation/micropython-microbit-v2-simulator.git .

# One at a time, as a top level recursive fetch will pull unnecessary MicroPython deps for other targets
RUN git submodule update --init lib/micropython-microbit-v2 \
	&& git -C lib/micropython-microbit-v2 submodule update --init lib/micropython

RUN npm ci

# STAGE is what the published build uses; it only names the environment.
RUN make STAGE=PRODUCTION

WORKDIR /src/build
