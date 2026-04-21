const crypto = require("crypto");

const HASH_ALGO = "scrypt";
const KEY_LENGTH = 64;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(`${HASH_ALGO}:${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, passwordHash) {
  return new Promise((resolve, reject) => {
    const [algo, salt, expected] = String(passwordHash || "").split(":");
    if (algo !== HASH_ALGO || !salt || !expected) {
      resolve(false);
      return;
    }
    crypto.scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      try {
        const actualBuffer = Buffer.from(derivedKey.toString("hex"), "hex");
        const expectedBuffer = Buffer.from(expected, "hex");
        if (actualBuffer.length !== expectedBuffer.length) {
          resolve(false);
          return;
        }
        resolve(crypto.timingSafeEqual(actualBuffer, expectedBuffer));
      } catch (comparisonError) {
        reject(comparisonError);
      }
    });
  });
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  createSessionToken,
  hashPassword,
  verifyPassword
};
