data "aws_ami" "ubuntu-node-ssdp" {
  most_recent = true

  filter {
    name   = "name"
    values = ["node-ssdp*"]
  }

  #owners = ["946804871181"]
  owners = ["self"]
}

data "aws_availability_zones" "available" {}
