function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prepareUtterance(text, {
  address = '好大爹',
  pool = [],
  history = [],
  keepAddress = false,
  chooseAddress = (current) => current
} = {}) {
  const previous = address || '好大爹';
  const nextAddress = keepAddress
    ? previous
    : chooseAddress(previous, pool, history) || previous;
  let result = String(text || '').replaceAll('{address}', nextAddress);
  const knownAddresses = pool
    .map((item) => item?.word)
    .filter(Boolean)
    .map(escapeRegExp);
  const prefix = knownAddresses.length
    ? new RegExp(`^(?:${knownAddresses.join('|')})[，,、：:\\s]+`)
    : null;
  const startsWithAddress = prefix?.test(result) || false;
  if (nextAddress !== previous) {
    result = startsWithAddress ? result.replace(prefix, `${nextAddress}，`) : `${nextAddress}，${result}`;
  } else if (startsWithAddress) {
    result = result.replace(prefix, `${nextAddress}，`);
  }
  return result;
}

module.exports = function createPetSpeech() {
  return { prepareUtterance, format: prepareUtterance };
};

module.exports.prepareUtterance = prepareUtterance;
