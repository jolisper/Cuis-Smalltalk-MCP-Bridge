// usage: node bindcheck.mjs <port> <host|default>  -> prints "free" or the bind error code
import net from 'node:net';
const [port, host] = [Number(process.argv[2]), process.argv[3]];
const s = net.createServer();
s.once('error', e => { console.log(e.code); process.exit(0); });
s.once('listening', () => { console.log('free'); s.close(); });
host === 'default' ? s.listen(port) : s.listen(port, host);
