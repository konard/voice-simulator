# voice-simulator HTTP API (synthesis, streaming, IPA, head meshes).
#
#   docker build -t voice-simulator .
#   docker run --rm -p 8080:8080 voice-simulator
#   curl -o hello.wav "http://localhost:8080/api/synthesize?text=Hello"
#
# The library has no runtime dependencies, so only bin/ and src/ are copied.
# node:24-alpine, pinned by digest.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080

COPY package.json README.md LICENSE ./
COPY bin ./bin
COPY src ./src

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["node", "bin/voice-simulator.js"]
CMD ["serve"]
