terraform {
  backend "s3" {
    bucket = "diversario-tfstate"
    key    = "node-ssdp/terraform.tfstate"
    region = "us-west-1"
  }
}

provider "aws" {
  profile = "terraform"
  region = "us-west-1"
}

resource "aws_vpc" "node-ssdp-vpc" {
  cidr_block = "10.100.0.0/16"
  enable_dns_hostnames = true

  tags {
    Name = "node-ssdp-vpc"
  }
}

resource "aws_internet_gateway" "node-ssdp-igw" {
  vpc_id = "${aws_vpc.node-ssdp-vpc.id}"

  tags {
    Name = "node-ssdp-igw"
  }
}

resource "aws_route" "node-ssdp-igw-route" {
  route_table_id            = "${aws_vpc.node-ssdp-vpc.main_route_table_id}"
  destination_cidr_block = "0.0.0.0/0"
  gateway_id = "${aws_internet_gateway.node-ssdp-igw.id}"
}

resource "aws_subnet" "node-ssdp-subnet" {
  vpc_id = "${aws_vpc.node-ssdp-vpc.id}"
  cidr_block = "10.100.1.0/24"
  availability_zone = "${data.aws_availability_zones.available.names[0]}"

  tags {
    Name = "node-ssdp-subnet"
  }

  map_public_ip_on_launch = true
}

resource "aws_security_group" "allow-all" {
  name        = "node-ssdp-allow-all"
  description = "Allow all inbound traffic"
  vpc_id      = "${aws_vpc.node-ssdp-vpc.id}"

  ingress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port       = 0
    to_port         = 0
    protocol        = "-1"
    cidr_blocks     = ["0.0.0.0/0"]
    #prefix_list_ids = ["pl-12c4e678"]
  }
}

resource "aws_instance" "node-ssdp" {
  count = "${var.instance-count}"

  ami = "${data.aws_ami.ubuntu-node-ssdp.id}"

  instance_type = "t2.micro"

  tags {
    Name = "node-ssdp-${count.index}"
  }

  vpc_security_group_ids = ["${aws_security_group.allow-all.id}"]

  subnet_id = "${aws_subnet.node-ssdp-subnet.id}"
  availability_zone = "${aws_subnet.node-ssdp-subnet.availability_zone}"
  associate_public_ip_address = true
}

