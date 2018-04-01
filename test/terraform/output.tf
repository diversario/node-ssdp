output "vpc-id" {
  value = "${aws_vpc.node-ssdp-vpc.id}"
}

output "subnet-id" {
  value = "${aws_subnet.node-ssdp-subnet.id}"
}

output "node-dns" {
  value = ["${aws_instance.node-ssdp.*.public_dns}"]
}

output "node-ips" {
  value = ["${aws_instance.node-ssdp.*.public_ip}"]
}
