import allContracts from "./contracts.json";
import abi from "./abi.json";
import { ChainApi } from "@defillama/sdk";
import { getApi } from "../../utils/sdk";
import { CoinData, Write } from "../../utils/dbInterfaces";
import { wrappedGasTokens } from "../../utils/gasTokens";
import {
  addToDBWritesList,
  getTokenAndRedirectData,
} from "../../utils/database";
import { getTokenInfo } from "../../utils/erc20";

export function mux(timestamp: number = 0) {
  console.log("starting mux");
  return Promise.all(
    Object.keys(allContracts).map((c) => getTokenPrices(c, timestamp)),
  );
}

async function getTokenPrices(
  chain: string,
  timestamp: number,
): Promise<Write[]> {
  const writes: Write[] = [];
  const api: ChainApi = await getApi(chain, timestamp);
  const contracts = allContracts[chain as keyof typeof allContracts];

  const allAssetInfo = await api.call({
    target: contracts.pool,
    abi: abi.getAllAssetInfo,
  });

  const assetAddresses: string[] = [
    ...new Set(
      allAssetInfo.map((i: any) =>
        i.tokenAddress == contracts.gasTokenDummy
          ? wrappedGasTokens[chain]
          : i.tokenAddress.toLowerCase(),
      ),
    ),
  ] as string[];

  const [poolBalances, tokenData, lpInfo, nonCirculating] = await Promise.all([
    api.multiCall({
      calls: assetAddresses.map((target: any) => ({
        target,
        params: contracts.pool,
      })),
      abi: "erc20:balanceOf",
    }),
    getTokenAndRedirectData(assetAddresses, chain, timestamp),
    getTokenInfo(chain, [contracts.MUXLP], undefined, {
      withSupply: true,
      timestamp,
    }),
    api.multiCall({
      target: contracts.MUXLP,
      calls: contracts.nonCirculating.map((params: string) => ({
        target: contracts.MUXLP,
        params,
      })),
      abi: "erc20:balanceOf",
    }),
  ]);

  let totalValue: number = 0;
  tokenData.map((d: CoinData) => {
    const i = assetAddresses.indexOf(d.address);
    if (i == -1) return;
    const assetValue = (poolBalances[i] * d.price) / 10 ** d.decimals;
    totalValue += assetValue;
  });

  const totalNonCirculating = nonCirculating.reduce(
    (p: number, c: number) => Number(p) + Number(c),
    0,
  );
  const circulatingSupply =
    (lpInfo.supplies[0].output - totalNonCirculating) /
    10 ** lpInfo.decimals[0].output;
  const price = totalValue / circulatingSupply;

  addToDBWritesList(
    writes,
    chain,
    contracts.MUXLP,
    price,
    lpInfo.decimals[0].output,
    lpInfo.symbols[0].output,
    timestamp,
    "mux",
    1,
  );

  return writes;
}
mux(); // ts-node coins/src/adapters/yield/mux/index.ts
