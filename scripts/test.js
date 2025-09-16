// Test just the function encoding without sending
import {ethers} from "ethers";

const router = new ethers.Contract(ROUTER_ADDRESS, SWAP_ROUTER_ABI, provider);
const params = {
    tokenIn: WIP_ADDRESS,
    tokenOut: "0x50457749f101c38d8c979f9b2136d2ecbd8c2441",
    fee: 3000,
    recipient: wallet.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    amountIn: ethers.parseUnits("0.001", 18),
    amountOutMinimum: 0n,
    sqrtPriceLimitX96: 0n
};

console.log("Encoded data:", router.interface.encodeFunctionData("exactInputSingle", [params]));