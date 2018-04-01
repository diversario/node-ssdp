output "vpc-id" {
  value = "${aws_vpc.node-ssdp-vpc.id}"
}

output "node-ips-1" {
  value = ["${aws_instance.node-ssdp-1.*.public_ip}"]
}

output "node-ips-2" {
  value = ["${aws_instance.node-ssdp-2.*.public_ip}"]
}
