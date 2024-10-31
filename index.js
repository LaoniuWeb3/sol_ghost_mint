import { Connection, ComputeBudgetProgram, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import idl from './idl.json' assert { type: 'json' };
import base58 from 'bs58';
import fs from 'fs/promises';

// 常量定义
const GHOST_PROGRAM_ID = new PublicKey("Hp5cZFAyVUTY8bpkd6qsUvjqL8myKSRaCDvY3nxN65fU");
const GHOST_MINT = new PublicKey("7EsVJBgkBJ4XwuL1oQPPK4EBicwSFCjcwkSCRHCYbC1G");
const RPC_URL = 'https://cold-hanni-fast-mainnet.helius-rpc.com/';

// 等级相关的常量数组
const xe = [0, 1e10, 103e8, 11e9, 122e8, 14e9, 166e8, 203e8, 256e8, 333e8, 446e8, 615e8, 872e8, 1269e8, 1895e8, 2903e8, 4557e8, 7327e8, 1206e9, 20309e8, 34972e8, 34972e8];
const pe = [0, 31746, 36376, 41494, 60734, 186703, 394855, 729798, 1258065, 2097619, 3442424, 5632576, 8752033, 13306818, 21354167, 32572727, 50296020, 85201646, 138096774, 230663230, 442215942, 442215942];
const de = [0, 0, 95e9, 1957e8, 3135e8, 4636e8, 665e9, 9462e8, 13499e8, 19456e8, 28471e8, 4237e9, 5535e9, 7412e9, 11992e9, 1516e10, 217725e8, 385066e8, 51289e9, 7839e10, 151302e9, 0];

// 查询用户和系统信息
async function getGhostInfo(program, wallet) {
    try {
        const [ghostSysInfoPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("GhostSysInfo3")],
            program.programId
        );
        
        const [userSummaryPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("GhostUserSummary3"),
                wallet.publicKey.toBuffer()
            ],
            program.programId
        );

        // 并行查询系统和用户信息
        const [sysInfo, userSummary, tokenBalance] = await Promise.all([
            program.account.ghostSysInfo.fetch(ghostSysInfoPDA),
            program.account.ghostUserSummary.fetch(userSummaryPDA).catch(() => null),
            program.provider.connection.getTokenAccountBalance(
                await getAssociatedTokenAddress(GHOST_MINT, wallet.publicKey)
            ).catch(() => ({ value: { uiAmount: 0 } }))
        ]);

        // 如果用户未初始化，返回基础信息
        if (!userSummary) {
            return {
                systemInfo: {
                    totalSupply: "7600000000",
                    totalMinted: sysInfo.totalTokenMinted.toString() / 1e8,
                    totalMintTimes: sysInfo.mintedTimes.toString(),
                    totalStaked: sysInfo.totalStakedAmount.toString() / 1e8,
                    totalClaimed: sysInfo.totalTokenClaimed.toString() / 1e8,
                    uniqueUsers: sysInfo.uniqueUser.toString(),
                    levelDistribution: sysInfo.levelUser.map(x => x.toString())
                },
                userInfo: {
                    walletAddress: wallet.publicKey.toString(),
                    currentLevel: 0,
                    canMint: true,
                    mintedTimes: "0",
                    stakedAmount: "0",
                    unclaimedReward: "0",
                    totalBalance: 0,
                    claimedReward: "0",
                    canClaim: false,
                    canUpgrade: false
                }
            };
        }

        const currentLevel = userSummary.level.toNumber();

                // 获取可领取收益
                const simulateResult = await program.methods.ghostxClaim()
                .accounts({})
                .simulate();
            
            const claimInfo = {
                amount: simulateResult.events[0].data.amount.toString() / 1e8,
                nextClaimAmount: simulateResult.events[0].data.nextClaimAmount.toString() / 1e8,
                nextClaimTime: simulateResult.events[0].data.nextClaimTime.toString()
            };
        
        return {
            systemInfo: {
                totalSupply: "7600000000",
                totalMinted: sysInfo.totalTokenMinted.toString() / 1e8,
                totalMintTimes: sysInfo.mintedTimes.toString(),
                totalStaked: sysInfo.totalStakedAmount.toString() / 1e8,
                totalClaimed: sysInfo.totalTokenClaimed.toString() / 1e8,
                uniqueUsers: sysInfo.uniqueUser.toString(),
                levelDistribution: sysInfo.levelUser.map(x => x.toString())
            },
            userInfo: {
                walletAddress: wallet.publicKey.toString(),
                currentLevel: currentLevel,
                dailyReward: (pe[currentLevel] / 1e8) * 24 * 3600,
                mintedTimes: userSummary.mintedTimes.toString(),
                canMint: userSummary.mintedTimes < 10,
                stakedAmount: userSummary.stakedAmount.toString() / 1e8,
                // 直接使用合约返回的未领取数量
                // unclaimedReward: userSummary.tmpUnclaimed.toString() / 1e8 || 0,  // 使用 unclaimed 而不是 tmpUnclaimed
                totalBalance: tokenBalance.value.uiAmount,
                claimedReward: userSummary.tokenClaimed.toString() / 1e8,
                canClaim: userSummary.unclaimed > 0,
                canUpgrade: userSummary.stakedAmount >= de[currentLevel + 1],
                nextLevelStakeRequired: de[currentLevel + 1] / 1e8,
                unclaimedReward: claimInfo.amount,  // 使用模拟调用获取的收益值
                nextClaimTime: claimInfo.nextClaimTime,
                nextClaimAmount: claimInfo.nextClaimAmount,
                curLevelUpgradeAmt: de[currentLevel + 1] / 1e8 - userSummary.stakedAmount
            }
        };
    } catch (error) {
        console.error("获取信息失败:", error);
        throw error;
    }
}

// 打印状态信息
function printStatus(info) {
    const { systemInfo, userInfo } = info;
    
    // 打印系统信息
    console.log("\n=== 系统信息 ===");
    console.log([
        `总量:${systemInfo.totalSupply}`,
        `已铸造:${systemInfo.totalMinted.toFixed(2)}`,
        `总Mint次数:${systemInfo.totalMintTimes}`,
        `总质押:${systemInfo.totalStaked.toFixed(2)}`,
        `总领取:${systemInfo.totalClaimed.toFixed(2)}`,
        `用户数:${systemInfo.uniqueUsers}`
    ].join(' | '));

    // 打印等级分布（只显示有用户的等级）
    const levelDist = systemInfo.levelDistribution
        .map((count, level) => parseInt(count))
        .map((count, level) => count > 0 ? `Lv${level}:${count}` : null)
        .filter(x => x)
        .join(' | ');
    console.log('等级分布:', levelDist);

    // 打印用户信息
    console.log("\n=== 用户信息 ===");
    const shortAddr = userInfo.walletAddress.slice(0,4) + '..' + userInfo.walletAddress.slice(-4);
    console.log([
        `地址:${shortAddr}`,
        `Lv${userInfo.currentLevel}`,
        `Mint:${userInfo.mintedTimes}/10`,
        `质押:${userInfo.stakedAmount}`,
        `未领取:${userInfo.unclaimedReward}`,
        `总余额:${userInfo.totalBalance}`,
        `已领取:${userInfo.claimedReward}`,
        `每日收益:${userInfo.dailyReward?.toFixed(2) || 0}`,
        `Mint:${userInfo.canMint ? '✅' : '❌'}`,
        `Summon:${!userInfo.canMint ? '✅' : '❌'}`,
        `Claim:${userInfo.canClaim ? '✅' : '❌'}`
    ].join(' | '));

    // 如果可以升级，显示升级信息
    if (!userInfo.canUpgrade && userInfo.nextLevelStakeRequired) {
        console.log(`升级到 Lv${userInfo.currentLevel + 1} 还需质押: ${(userInfo.nextLevelStakeRequired - userInfo.stakedAmount).toFixed(2)} GHOST`);
    }
}

// 单个钱包 mint
async function mintGhost(privateKey) {
    try {
        const connection = new Connection(RPC_URL, 'processed');
        const wallet = new anchor.Wallet(Keypair.fromSecretKey(base58.decode(privateKey)));
        
        const provider = new anchor.AnchorProvider(
            connection, 
            wallet,
            {
                commitment: 'processed',
                preflightCommitment: 'processed',
                skipPreflight: true
            }
        );
        
        anchor.setProvider(provider);
        
        const program = new anchor.Program(idl, provider);
        console.log("钱包地址：", wallet.publicKey.toString());

        // 查询状态
        const info = await getGhostInfo(program, wallet);
        printStatus(info);

        if (!info.userInfo.canMint) {
            console.log("无法继续 Mint，检查是否可以质押升级...");
            
            // 检查当前余额是否满足质押条件
            if (info.userInfo.totalBalance >= info.userInfo.curLevelUpgradeAmt) {
                console.log("余额满足质押条件，执行质押...");
                const tx = await program.methods.ghostxUpgrade()
                    .preInstructions([ComputeBudgetProgram.setComputeUnitPrice({
                        microLamports: 38518
                    })])
                    .transaction();

                tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                tx.feePayer = wallet.publicKey;

                const signedTx = await wallet.signTransaction(tx);
                const txid = await connection.sendRawTransaction(signedTx.serialize());
                
                console.log('质押交易已提交:', txid);
                await connection.confirmTransaction(txid);
                
                // // 查询最新状态
                // const newInfo = await getGhostInfo(program, wallet);
                // printStatus(newInfo);
                return true; // 继续执行
            } else {
                console.log(`当前余额 ${userInfo.totalBalance} 不足以质押，需要 ${userInfo.curLevelUpgradeAmt}`);
                return false; // 暂停执行
            }
        }

        // 检查 SOL 余额
        const balance = await connection.getBalance(wallet.publicKey);
        if (balance < 2044280) {
            console.log(`SOL 余额不足: ${balance/1e9}`);
            return;
        }

        // 获取 ATA
        const ata = await getAssociatedTokenAddress(GHOST_MINT, wallet.publicKey);
        const account = await connection.getAccountInfo(ata);

        // 准备交易
        const instructions = [];
        if (!account) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    wallet.publicKey, ata, wallet.publicKey, GHOST_MINT
                )
            );
        }

        instructions.push(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 38518 })
        );

        // 发送交易
        const tx = await program.methods.ghostxMint()
            .preInstructions(instructions)
            .transaction();

        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = wallet.publicKey;

        const signedTx = await wallet.signTransaction(tx);
        const txid = await connection.sendRawTransaction(signedTx.serialize());
        
        console.log('mint交易已提交:', txid);
        await connection.confirmTransaction(txid);
        
        // // 查询最新状态
        // const newInfo = await getGhostInfo(program, wallet);
        // printStatus(newInfo);

    } catch (error) {
        console.error('Mint 失败:', error);
        if (error.logs) {
            console.error('错误日志:', error.logs);
        }
    }
}

// 自动 mint
async function autoMint() {
    try {
        const privateKeys = (await fs.readFile('ghost_keys.txt', 'utf8'))
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        if (privateKeys.length === 0) {
            console.error('没有找到有效的私钥');
            return;
        }

        while (true) {
            console.log(`\n开始新一轮处理，共 ${privateKeys.length} 个钱包`);

            for (const [index, privateKey] of privateKeys.entries()) {
                console.log(`\n处理第 ${index + 1}/${privateKeys.length} 个钱包`);
                await mintGhost(privateKey);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            console.log('\n等待下一轮...');
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    } catch (error) {
        console.error('自动Mint失败:', error);
    }
}

autoMint().catch(console.error);