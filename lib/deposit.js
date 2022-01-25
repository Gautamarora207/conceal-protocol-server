
const merkleTree = require("./MerkleTree");
const fs = require("fs");
const circomlib = require("circomlib");

const snarkjs = require("snarkjs");
const bigInt = snarkjs.bigInt;
const Web3 = require("web3");

const buildGroth16 = require("websnark/src/groth16");
const websnarkUtils = require("websnark/src/utils");

const MERKLE_TREE_HEIGHT = 20;

let contract;
let groth16;
let circuit = require("../build/circuits/withdraw.json");
const { RPC_URLS } = require("../constants");
let proving_key;
let web3;
let contractAddress;
let rpcUrl;
let fees;


const toHex = (number, length = 32) =>
  "0x" +
  (number instanceof Buffer
    ? number.toString("hex")
    : bigInt(number).toString(16)
  ).padStart(length * 2, "0");

  const toFixedHex = (number, length = 32) =>
  "0x" +
  bigInt(number)
    .toString(16)
    .padStart(length * 2, "0");



async function generateMerkleProof(deposit) {
  web3 = await new Web3(
    new Web3.providers.HttpProvider(rpcUrl, { timeout: 5 * 60 * 1000 }),
    null,
    { transactionConfirmationBlocks: 1 }
  );


  contract =await new web3.eth.Contract(
    require("../build/ETHTornado.json").abi,
    contractAddress
  );

  console.log("Getting contract state...");
  const events = await contract.getPastEvents("Deposit", {
    fromBlock: 0,
    toBlock: "latest",
  });
  const leaves = events
    .sort((a, b) => a.returnValues.leafIndex - b.returnValues.leafIndex) // Sort events in chronological order
    .map((e) => e.returnValues.commitment);
  const tree = new merkleTree(MERKLE_TREE_HEIGHT, leaves);

  // Find current commitment in the tree
  let depositEvent = events.find(
    (e) => e.returnValues.commitment === toHex(deposit.commitment)
  );
  events.find(
    (e) => e.returnValues.commitment === toHex(deposit.commitment)
  );
  console.log()
  let leafIndex = depositEvent ? depositEvent.returnValues.leafIndex : -1;
  console.log("leafIndex " + leafIndex);
  // Validate that our data is correct (optional)
  const isValidRoot = await contract.methods
    .isKnownRoot(toHex(await tree.root()))
    .call();
  const isSpent = await contract.methods
    .isSpent(toHex(deposit.nullifierHash))
    .call();
  console.log("isvalid " + isValidRoot);
  console.log("isSpent " + isSpent);
  // Compute merkle proof of our commitment
  return await tree.path(leafIndex);
}


async function generateSnarkProof(deposit, recipient) {
  // Compute merkle proof of our commitment
  const { root, path_elements, path_index } = await generateMerkleProof(deposit);
  console.log(fees);
  // Prepare circuit input
  const input = {
    // Public snark inputs
    root: root,
    nullifierHash: deposit.nullifierHash,
    recipient: bigInt(recipient),
    relayer: bigInt("0xb409FF9A770589eD5673fC8bDE71D899A658ec24"),
    fee: fees,
    refund: 0,

    // Private snark inputs
    nullifier: deposit.nullifier,
    secret: deposit.secret,
    pathElements: path_elements,
    pathIndices: path_index,
  };

  groth16 = await buildGroth16();
  proving_key = await fs.readFileSync(
    __dirname +  "/../build/circuits/withdraw_proving_key.bin"
  ).buffer;

  console.log("Generating SNARK proof...");
  const proofData = await websnarkUtils.genWitnessAndProve(
    groth16,
    input,
    circuit,
    proving_key
  );
  const { proof } = websnarkUtils.toSolidityInput(proofData);

  const args = [
    toFixedHex(input.root),
    toFixedHex(input.nullifierHash),
    toFixedHex(input.recipient, 20),
    toFixedHex(input.relayer, 20),
    toFixedHex(input.fee),
    toFixedHex(input.refund),
  ];

  return { proof, args };
}

/**
 * Create deposit object from secret and nullifier
 */
function createDeposit(nullifier, secret) {
    let deposit = { nullifier, secret };
    deposit.preimage = Buffer.concat([
      deposit.nullifier.leInt2Buff(31),
      deposit.secret.leInt2Buff(31),
    ]);
    deposit.commitment = pedersenHash(deposit.preimage);
    deposit.nullifierHash = pedersenHash(deposit.nullifier.leInt2Buff(31));
    return deposit;
}


const pedersenHash = (data) =>
    circomlib.babyJub.unpackPoint(circomlib.pedersenHash.hash(data))[0];
  

function parseNote(noteString) {
  console.log(noteString);
    const noteRegex =
      /morphose-(?<currency>\w+)-(?<amount>[\d.]+)-(?<netId>\d+)-0x(?<contractAddress>[0-9a-fA-F]{40})-0x(?<note>[0-9a-fA-F]{124})/g;
    const match = noteRegex.exec(noteString);
    // we are ignoring `currency`, `amount`,`netId`, `contractAddress` for this minimal example
    contractAddress = match.groups.contractAddress;
    rpcUrl = RPC_URLS[match.groups.netId];
    fees = Web3.utils.toWei(`${parseFloat(match.groups.amount) / 10}`, "ether");
    const buf = Buffer.from(match.groups.note, "hex");
    const nullifier = bigInt.leBuff2int(buf.slice(0, 31));
    const secret = bigInt.leBuff2int(buf.slice(31, 62));
    return createDeposit(nullifier, secret);
}

module.exports = { parseNote, generateSnarkProof }
