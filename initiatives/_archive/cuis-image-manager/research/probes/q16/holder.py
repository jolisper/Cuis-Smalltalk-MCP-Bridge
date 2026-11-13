# usage: python3 -I holder.py <host> <port> [v6]  -> listens until killed
import socket, sys, time
fam = socket.AF_INET6 if len(sys.argv) > 3 else socket.AF_INET
s = socket.socket(fam, socket.SOCK_STREAM)
if fam == socket.AF_INET6: s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
s.bind((sys.argv[1], int(sys.argv[2]))); s.listen(1); time.sleep(600)
