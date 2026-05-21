import * as crypto from 'crypto';

const DH_PRIME = Buffer.from(
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF',
  'hex'
);

export interface DHKeyPair {
  privateKey: Buffer;
  publicKeyHex: string;
}

export function generateDHKeyPair(): DHKeyPair {
  const dh = crypto.createDiffieHellman(DH_PRIME, Buffer.from([2]));
  dh.generateKeys();
  return {
    privateKey: dh.getPrivateKey(),
    publicKeyHex: dh.getPublicKey('hex'),
  };
}

export function computeSharedKey(serverPubHex: string, privateKey: Buffer): Buffer {
  const dh = crypto.createDiffieHellman(DH_PRIME, Buffer.from([2]));
  dh.setPrivateKey(privateKey);
  dh.generateKeys();
  const shared = dh.computeSecret(Buffer.from(serverPubHex, 'hex'));
  return crypto.createHash('sha256').update(shared).digest();
}

export function encrypt(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('hex');
}

export function decrypt(key: Buffer, dataHex: string): string {
  const data = Buffer.from(dataHex, 'hex');
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(12, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
