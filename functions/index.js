const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Credencial de produção do Mercado Pago
const MP_ACCESS_TOKEN = "APP_USR-3757723833365475-031614-3c79b2c8ea28a792803522db9cc6e780-1318093812";

// Configuração dos Planos
const PLANOS = {
    mensal: {
        titulo: "PizzaControl - Plano Mensal",
        preco: 59.90,
        dias: 30
    },
    anual: {
        titulo: "PizzaControl - Plano Anual",
        preco: 598.80,
        dias: 365
    }
};

// ============================================================
// 1. GERADOR DE CHECKOUT DINÂMICO (Checkout Pro)
// ============================================================
exports.gerarCheckoutMP = functions.https.onRequest(async (req, res) => {
    // CORS — permite chamadas do frontend
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(204).send("");
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido. Use POST." });
    }

    try {
        const { uid, tipo_plano } = req.body;

        if (!uid || !tipo_plano) {
            return res.status(400).json({ error: "Campos 'uid' e 'tipo_plano' são obrigatórios." });
        }

        const plano = PLANOS[tipo_plano];
        if (!plano) {
            return res.status(400).json({ error: "tipo_plano deve ser 'mensal' ou 'anual'." });
        }

        console.log(`🛒 Gerando checkout ${tipo_plano} para UID: ${uid}`);

        // Criar Preferência de Pagamento via API REST do Mercado Pago
        const preference = {
            items: [
                {
                    title: plano.titulo,
                    quantity: 1,
                    unit_price: plano.preco,
                    currency_id: "BRL"
                }
            ],
            external_reference: uid,
            payment_methods: {
                // Aceita PIX, Cartão de Crédito, Boleto — tudo habilitado
                excluded_payment_types: [],
                excluded_payment_methods: [],
                installments: 12 // Até 12x no cartão
            },
            back_urls: {
                success: "https://app.pizzacontrol.com.br/app.html",
                failure: "https://app.pizzacontrol.com.br/index.html",
                pending: "https://app.pizzacontrol.com.br/index.html"
            },
            auto_return: "approved",
            statement_descriptor: "PIZZACONTROL",
            metadata: {
                tipo_plano: tipo_plano,
                uid: uid
            }
        };

        const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${MP_ACCESS_TOKEN}`
            },
            body: JSON.stringify(preference)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Erro ao criar preferência MP: ${response.status} - ${errorBody}`);
            return res.status(500).json({ error: "Falha ao gerar checkout no Mercado Pago." });
        }

        const data = await response.json();
        console.log(`✅ Checkout gerado! init_point: ${data.init_point}`);

        return res.status(200).json({
            init_point: data.init_point,
            sandbox_init_point: data.sandbox_init_point
        });

    } catch (error) {
        console.error("Erro interno ao gerar checkout:", error);
        return res.status(500).json({ error: "Erro interno do servidor." });
    }
});

// ============================================================
// 2. WEBHOOK DO MERCADO PAGO (Recebe notificações de pagamento)
// ============================================================
exports.webhookMercadoPago = functions.https.onRequest(async (req, res) => {
    // MP exige 200 rápido
    res.status(200).send("Webhook HTTP 200 OK");

    if (req.method !== "POST") return;

    try {
        const type = req.query.topic || req.body.type;
        const id = req.query.id || (req.body.data && req.body.data.id);

        if (!id) {
            console.log("Evento recebido sem ID de pagamento.");
            return;
        }

        if (type === "payment") {
            console.log(`Buscando dados do Pagamento ID: ${id}`);

            const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
                headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
            });

            if (!response.ok) {
                console.error(`Falha ao consultar MP. Status: ${response.status}`);
                return;
            }

            const paymentInfo = await response.json();

            if (paymentInfo.status) {
                const payerEmail = paymentInfo.payer ? paymentInfo.payer.email : null;
                const paymentStatus = paymentInfo.status;
                const externalReference = paymentInfo.external_reference || null;
                const transactionAmount = paymentInfo.transaction_amount || 0;

                try {
                    // Identificar o usuário: prioridade para external_reference (UID direto)
                    let uid;
                    if (externalReference) {
                        uid = externalReference;
                        console.log(`🎯 UID via external_reference: ${uid}`);
                    } else if (payerEmail) {
                        const userRecord = await admin.auth().getUserByEmail(payerEmail);
                        uid = userRecord.uid;
                        console.log(`📧 UID via e-mail (${payerEmail}): ${uid}`);
                    } else {
                        console.log("⚠️ Pagamento sem external_reference nem e-mail. Ignorando.");
                        return;
                    }

                    if (paymentStatus === "approved") {
                        console.log(`✅ Pagamento APROVADO para UID: ${uid} | Valor: R$${transactionAmount}`);

                        // Determinar plano pelo valor pago
                        const diasParaAdicionar = transactionAmount >= 500 ? 365 : 30;
                        const tipoPlano = diasParaAdicionar === 365 ? "anual" : "mensal";

                        const novaDataVencimento = new Date();
                        novaDataVencimento.setDate(novaDataVencimento.getDate() + diasParaAdicionar);

                        const dadosAtualizacao = {
                            status: "ativo",
                            plano: tipoPlano,
                            data_vencimento: admin.firestore.Timestamp.fromDate(novaDataVencimento),
                            ultimaRenovacao: admin.firestore.FieldValue.serverTimestamp(),
                            ultimoPagamento: transactionAmount
                        };

                        if (payerEmail) {
                            dadosAtualizacao.email = payerEmail;
                        }

                        await db.collection("usuarios").doc(uid).set(dadosAtualizacao, { merge: true });

                        await db.collection("config").doc(uid).set({
                            statusPagamento: "ativo"
                        }, { merge: true });

                        console.log(`🎉 Usuário ${uid} ATIVO! Plano: ${tipoPlano} | Vencimento: ${novaDataVencimento.toISOString()}`);
                        
                    } else if (["cancelled", "refunded", "charged_back", "rejected"].includes(paymentStatus)) {
                        console.log(`🛑 Pagamento ${paymentStatus} para UID: ${uid}`);
                        await db.collection("usuarios").doc(uid).set({
                            status: "inativo",
                            dataSuspensao: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        
                        await db.collection("config").doc(uid).set({
                            statusPagamento: "inativo"
                        }, { merge: true });

                        console.log(`🔒 Usuário ${uid} SUSPENSO!`);
                    } else {
                        console.log(`ℹ️ Status ignorado: ${paymentStatus}`);
                    }

                } catch (authErr) {
                    console.error("⚠️ Erro ao processar pagamento:", authErr);
                }
            }
        }
    } catch (error) {
        console.error("Erro interno ao processar webhook:", error);
    }
});
