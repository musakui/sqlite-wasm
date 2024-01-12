FROM debian:bookworm-slim as builder

ARG EMSCRIPTEN_VERSION=latest
ENV EMSDK /emsdk

RUN apt-get -qq -y update \
	&& apt-get -qq install -y --no-install-recommends \
		git \
		file \
		binutils \
		python3 \
		python3-pip \
		ca-certificates \
		build-essential

RUN git clone --depth 1 https://github.com/emscripten-core/emsdk.git

WORKDIR ${EMSDK}

RUN ./emsdk install ${EMSCRIPTEN_VERSION}

RUN ./emsdk activate ${EMSCRIPTEN_VERSION} \
	&& chmod 777 ${EMSDK}/upstream/emscripten \
	&& echo "int main() { return 0; }" > hello.c \
	&& ${EMSDK}/upstream/emscripten/emcc -c hello.c \
	&& cat ${EMSDK}/upstream/emscripten/cache/sanity.txt \
	&& rm hello.c

RUN . ./emsdk_env.sh \
	&& strip -s `which node` \
	&& rm -rf ${EMSDK}/upstream/emscripten/tests \
	&& find ${EMSDK}/upstream/bin -type f -exec strip -s {} + || true

FROM debian:bookworm-slim

RUN apt-get -qq -y update \
	&& apt-get -qq install -y --no-install-recommends \
		tcl \
		curl \
		make \
		wabt \
		python3 \
		python3-pip \
		build-essential \
		ca-certificates \
	&& apt-get -y clean \
	&& apt-get -y autoclean \
	&& apt-get -y autoremove \
	&& rm -rf /var/lib/apt/lists/* \
	&& rm -rf /var/cache/debconf/*-old \
	&& rm -rf /usr/share/doc/* \
	&& rm -rf /usr/share/man/?? \
	&& rm -rf /usr/share/man/??_*

COPY --from=builder /emsdk /emsdk

RUN curl -fsSL --compressed -o sqlite.tar.gz \
	https://www.sqlite.org/src/tarball/sqlite.tar.gz?r=release \
	&& tar -xf sqlite.tar.gz \
	&& rm sqlite.tar.gz \
	&& cd sqlite \
	&& ./configure --enable-all \
	&& make sqlite3.c 

ENV EMSDK=/emsdk
ENV PATH="/emsdk:/emsdk/upstream/emscripten:/emsdk/node/16.20.0_64bit/bin:${PATH}"

WORKDIR /sqlite/ext/wasm
