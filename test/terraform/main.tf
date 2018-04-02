terraform {
  backend "s3" {
    bucket = "diversario-tfstate"
    key    = "node-ssdp/terraform.tfstate"
    region = "us-west-1"
  }
}

provider "aws" {
  profile = "terraform"
  region  = "us-west-1"
}

resource "aws_vpc" "node-ssdp-vpc" {
  cidr_block           = "10.100.0.0/16"
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
  route_table_id         = "${aws_vpc.node-ssdp-vpc.main_route_table_id}"
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = "${aws_internet_gateway.node-ssdp-igw.id}"
}

resource "aws_subnet" "node-ssdp-subnet-1" {
  vpc_id            = "${aws_vpc.node-ssdp-vpc.id}"
  cidr_block        = "10.100.1.0/24"
  availability_zone = "${data.aws_availability_zones.available.names[0]}"

  tags {
    Name = "node-ssdp-subnet-1"
  }

  # map_public_ip_on_launch = true
}

resource "aws_subnet" "node-ssdp-subnet-2" {
  vpc_id            = "${aws_vpc.node-ssdp-vpc.id}"
  cidr_block        = "10.100.2.0/24"
  availability_zone = "${data.aws_availability_zones.available.names[0]}"

  tags {
    Name = "node-ssdp-subnet-2"
  }
}

############################
# ENIs
############################

resource "aws_network_interface" "node-ssdp-eni-1" {
  count = "${var.instance-count}"

  subnet_id       = "${aws_subnet.node-ssdp-subnet-1.id}"
  security_groups = ["${aws_security_group.allow-all.id}"]
}

resource "aws_network_interface_attachment" "node-ssdp-eni-attachment-1" {
  count = "${var.instance-count}"

  instance_id          = "${element(aws_instance.node-ssdp-2.*.id, count.index)}"
  network_interface_id = "${element(aws_network_interface.node-ssdp-eni-1.*.id, count.index)}"
  device_index         = 1
}

resource "aws_network_interface" "node-ssdp-eni-2" {
  count = "${var.instance-count}"

  subnet_id       = "${aws_subnet.node-ssdp-subnet-2.id}"
  security_groups = ["${aws_security_group.allow-all.id}"]
}

resource "aws_network_interface_attachment" "node-ssdp-eni-attachment-2" {
  count = "${var.instance-count}"

  instance_id          = "${element(aws_instance.node-ssdp-1.*.id, count.index)}"
  network_interface_id = "${element(aws_network_interface.node-ssdp-eni-2.*.id, count.index)}"
  device_index         = 1
}

############################
# SG
############################

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
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

############################
# EC2
############################

resource "aws_instance" "node-ssdp-1" {
  count = "${var.instance-count}"

  ami = "${data.aws_ami.ubuntu-node-ssdp.id}"

  instance_type = "t2.micro"

  tags {
    Name = "node-ssdp-subnet-1-${count.index}"
  }

  vpc_security_group_ids = ["${aws_security_group.allow-all.id}"]

  subnet_id         = "${aws_subnet.node-ssdp-subnet-1.id}"
  availability_zone = "${aws_subnet.node-ssdp-subnet-1.availability_zone}"

  key_name = "terraform"

  associate_public_ip_address = true
}

resource "aws_instance" "node-ssdp-2" {
  count = "${var.instance-count}"

  ami = "${data.aws_ami.ubuntu-node-ssdp.id}"

  instance_type = "t2.micro"

  tags {
    Name = "node-ssdp-subnet-2-${count.index}"
  }

  vpc_security_group_ids = ["${aws_security_group.allow-all.id}"]

  subnet_id         = "${aws_subnet.node-ssdp-subnet-2.id}"
  availability_zone = "${aws_subnet.node-ssdp-subnet-2.availability_zone}"

  key_name = "terraform"

  associate_public_ip_address = true
}
