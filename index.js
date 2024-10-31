// ghost.js
import { Connection, ComputeBudgetProgram, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import idl from './idl.json' assert { type: 'json' };
import base58 from 'bs58';
import fs from 'fs/promises';

// 检查 mint 次数
async function checkMintTimes(program, wallet) {
    try {
        const [userSummaryPDA] = anchor.web3.PublicKey.findProgramAddressSync(
            [
                Buffer.from("GhostUserSummary3"),
                wallet.publicKey.toBuffer()
            ],
            program.programId
        );

        const userSummary = await program.account.ghostUserSummary.fetch(userSummaryPDA);
        const mintTimes = parseInt(userSummary.mintedTimes.toString());
        console.log(`当前 Mint 次数: ${mintTimes}`);
        return mintTimes;
    } catch (error) {
        console.log('首次 Mint，当前次数为 0');
        return 0;
    }
}

// 单个钱包 mint
async function mintGhost(privateKey) {
    // 连接到 Solana 网络
    const connection = new Connection('https://cold-hanni-fast-mainnet.helius-rpc.com/', {
        commitment: 'processed'
    });

    // 设置钱包
    const wallet = new anchor.Wallet(Keypair.fromSecretKey(base58.decode(privateKey)));

    // 创建 Provider
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'processed',
        preflightCommitment: 'processed',
        skipPreflight: true
    });

    console.log("钱包地址：", wallet.publicKey.toBase58());

    // 初始化程序
    const program = new anchor.Program(idl, provider);

    try {
        // 交易确认后再次查询并显示最新状态
        const newMintTimes = await checkMintTimes(program, wallet);
        console.log(`Mint 完成后状态:当前 Mint 次数: ${newMintTimes}距离上限还剩: ${10 - newMintTimes} 次`);
        if (newMintTimes >= 10) {
            console.log("Mint 次数已达上限，退出");
            return;
        }

        // 检查余额
        const balance = await connection.getBalance(wallet.publicKey);
        const minimumBalance = 2039280; // 约 0.00203928 SOL
        const estimatedFee = 5000;
        const totalRequired = minimumBalance + estimatedFee;
        
        if (balance < totalRequired) {
            console.error(`
                SOL 余额不足:
                当前余额: ${balance/1e9} SOL
                最小需要: ${minimumBalance/1e9} SOL
                预估手续费: ${estimatedFee/1e9} SOL
                总计需要: ${totalRequired/1e9} SOL
                差额: ${(totalRequired - balance)/1e9} SOL
            `);
            return;
        }

        // 获取 ATA 地址
        const ghostMint = new PublicKey('7EsVJBgkBJ4XwuL1oQPPK4EBicwSFCjcwkSCRHCYbC1G');
        const ata = await getAssociatedTokenAddress(
            ghostMint,
            wallet.publicKey
        );

        // 检查 ATA 是否存在
        let account;
        try {
            account = await connection.getAccountInfo(ata);
            // console.log("ata", "账户存在")
        } catch (e) {
            account = null;
            console.log("ata", "账户不存在")
        }

        // 准备交易指令
        let instructions = [];
        
        // 如果 ATA 不存在，添加创建指令
        if (!account) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    wallet.publicKey,  // payer
                    ata,               // ata
                    wallet.publicKey,  // owner
                    ghostMint          // mint
                )
            );
        }

        // 添加 ComputeBudget 指令
        instructions.push(
            ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 38518
            })
        );

        // 创建 mint 交易
        const tx = await program.methods
            .ghostxMint()
            .preInstructions(instructions)
            .transaction();

        // 获取最新的 blockhash
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = wallet.publicKey;

        // 签名并发送交易
        const signedTx = await wallet.signTransaction(tx);
        const txid = await connection.sendRawTransaction(signedTx.serialize());
        
        console.log('交易已提交:', txid);
        
        // 等待交易确认
        const confirmation = await connection.confirmTransaction(txid);
        console.log('交易已确认:', confirmation);

    } catch (error) {
        if (error.logs) {
            console.error('交易失败，详细日志：');
            error.logs.forEach(log => console.error(log));
        }
        console.error('Mint 失败:', error);
    }
}

// 读取私钥文件
async function loadPrivateKeys() {
    try {
        const content = await fs.readFile('ghost_keys.txt', 'utf8');
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#')); // 过滤空行和注释
    } catch (error) {
        console.error('读取私钥文件失败:', error);
        return [];
    }
}

// 自动 mint
async function autoMint() {
    while (true) {
        const privateKeys = await loadPrivateKeys();
        if (privateKeys.length === 0) {
            console.error('没有找到有效的私钥');
            return;
        }

        console.log(`\n开始新一轮处理，共 ${privateKeys.length} 个钱包`);
        let allCompleted = true;

        for (let i = 0; i < privateKeys.length; i++) {
            console.log(`\n处理第 ${i + 1}/${privateKeys.length} 个钱包`);
            const shouldContinue = await mintGhost(privateKeys[i]);
            if (shouldContinue) {
                allCompleted = false;
            }
            // 每个钱包处理完后等待一段时间
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // if (allCompleted) {
        //     console.log('\n所有钱包都已完成 10 次 mint，程序结束');
        //     break;
        // }

        console.log('\n等待下一轮处理...');
        // 每轮处理完后等待较长时间
        await new Promise(resolve => setTimeout(resolve, 30000));
    }
}

// 运行自动 mint
autoMint().catch(console.error);