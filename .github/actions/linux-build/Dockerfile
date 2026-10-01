FROM snapcore/snapcraft:stable@sha256:6d771575c134569e28a590f173f7efae8bf7f4d1746ad8a474c98e02f4a3f627

COPY entrypoint.sh /entrypoint.sh

RUN apt-get update
RUN apt-get install -y build-essential git-core unzip curl pkg-config rpm
RUN curl -sL https://deb.nodesource.com/setup_15.x | sudo -E bash -
RUN apt-get install -y nodejs
RUN npm i -g grunt-cli

ENTRYPOINT ["/entrypoint.sh"]
