sudo yum install -y git-core

NODE_VERSION='8.11.1'
FILENAME="node-v${NODE_VERSION}-linux-x64"

curl -O https://nodejs.org/dist/v8.11.1/$FILENAME.tar.xz

tar xf $FILENAME.tar.xz

sudo mv $FILENAME/lib/* /usr/local/lib/
sudo mv $FILENAME/bin/* /usr/local/bin/

git clone https://github.com/diversario/node-ssdp.git

cd node-ssdp
npm install
