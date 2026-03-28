const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ATENÇÃO: Substitua pela sua credencial de produção do MP
const MP_ACCESS_TOKEN = "APP_USR-3757723833365475-031614-3c79b2c8ea28a792803522db9cc6e780-1318093812";

if (MP_ACCESS_TOKEN === "SEU_ACCESS_TOKEN_AQUI") {
    console.warn("⚠️ AVISO: Você ainda não configurou o Access Token do Mercado Pago!");
}

// Escutando Webhooks do Mercado Pago
exports.webhookMercadoPago = functions.https.onRequest(async (req, res) => {
    // 1. MP exige que retornemos 200 rapidamente, senão ele tenta reenviar o evento
    res.status(200).send("Webhook HTTP 200 OK");

    // Aceitar apenas POST
    if (req.method !== "POST") return;

    try {
        const type = req.query.topic || req.body.type;
        const id = req.query.id || (req.body.data && req.body.data.id);

        if (!id) {
            console.log("Evento recebido sem ID de pagamento.");
            return;
        }

        // Lidar com evento de Pagamento
        if (type === "payment") {
            console.log(`Buscando dados do Pagamento ID: ${id}`);

            // Usando fetch nativo (Node 18+) para blindagem contra quebras de versão do SDK do Mercado Pago
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
                headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
            });

            if (!response.ok) {
                console.error(`Falha ao consultar MP. Status: ${response.status}`);
                return;
            }

            const paymentInfo = await response.json();

        // 2. Verificar o status do pagamento
            if (paymentInfo.status) {
                const payerEmail = paymentInfo.payer ? paymentInfo.payer.email : null;
                const paymentStatus = paymentInfo.status;
                const externalReference = paymentInfo.external_reference || null;

                try {
                    // 3. Identificar o usuário: prioridade para external_reference (UID direto)
                    let uid;
                    if (externalReference) {
                        uid = externalReference;
                        console.log(`🎯 UID encontrado via external_reference: ${uid}`);
                    } else if (payerEmail) {
                        // Fallback: buscar pelo e-mail no Firebase Auth
                        const userRecord = await admin.auth().getUserByEmail(payerEmail);
                        uid = userRecord.uid;
                        console.log(`📧 UID encontrado via e-mail (${payerEmail}): ${uid}`);
                    } else {
                        console.log("⚠️ Pagamento sem external_reference nem e-mail. Ignorando.");
                        return;
                    }

                    if (paymentStatus === "approved") {
                        console.log(`✅ Pagamento APROVADO para UID: ${uid}`);

                        // 4. Calcular nova data de vencimento (+30 dias a partir de HOJE)
                        const novaDataVencimento = new Date();
                        novaDataVencimento.setDate(novaDataVencimento.getDate() + 30);

                        // 5. Atualizar Firestore (coleção 'usuarios')
                        const dadosAtualizacao = {
                            status: "ativo",
                            data_vencimento: admin.firestore.Timestamp.fromDate(novaDataVencimento),
                            ultimaRenovacao: admin.firestore.FieldValue.serverTimestamp()
                        };

                        if (payerEmail) {
                            dadosAtualizacao.email = payerEmail;
                        }

                        await db.collection("usuarios").doc(uid).set(dadosAtualizacao, { merge: true });

                        // Atualizar também na config local do App para segurança redundante
                        await db.collection("config").doc(uid).set({
                            statusPagamento: "ativo"
                        }, { merge: true });

                        console.log(`🎉 Usuário ${uid} marcado como ATIVO! Vencimento: ${novaDataVencimento.toISOString()}`);
                        
                    } else if (["cancelled", "refunded", "charged_back", "rejected"].includes(paymentStatus)) {
                        console.log(`🛑 Pagamento CANCELADO/INATIVO (${paymentStatus}) para UID: ${uid}`);
                        // 6. Revogar acesso do usuário (Suspender)
                        await db.collection("usuarios").doc(uid).set({
                            status: "inativo",
                            dataSuspensao: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        
                        await db.collection("config").doc(uid).set({
                            statusPagamento: "inativo"
                        }, { merge: true });

                        console.log(`🔒 Usuário ${uid} SUSPENSO (inativo)!`);
                    } else {
                        console.log(`ℹ️ Pagamento verificado, status ignorado no momento: ${paymentStatus}`);
                    }

                } catch (authErr) {
                    console.error(`⚠️ Erro ao processar pagamento:`, authErr);
                }
            } else {
                console.log(`Pagamento sem status identificável.`);
            }
        }
    } catch (error) {
        console.error("Erro interno ao processar webhook:", error);
    }
});
