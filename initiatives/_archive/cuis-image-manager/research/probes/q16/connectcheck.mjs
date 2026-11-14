// usage: node connectcheck.mjs <port>  -> "in-use" if a TCP connect to 127.0.0.1 succeeds, else the error code
import net from 'node:net';
const c = net.connect(Number(process.argv[2]), '127.0.0.1');
c.setTimeout(1000, () => { console.log('timeout'); c.destroy(); });
c.once('connect', () => { console.log('in-use'); c.destroy(); });
c.once('error', e => console.log(e.code));
