console.log('🍕 APP.JS CARREGADO - MODO SAAS FIREBASE + LOCALSTORAGE');

let isPro = false;

let STORAGE_KEY = 'pizzaControlLocalDB_v1';
const STORAGE_KEY_BASE = 'pizzaControlLocalDB_v1';
const SESSION_KEY = 'pizzaControlSession';
const PIN_MASTER_KEY = 'pizzaControlPinMaster';
const RECOVERY_HASH_KEY = 'pizzaControlRecoveryKeyHash';
const LEGACY_KEYS = ['pizzaControlFinal', 'pizzaControlDados', 'pizzaControlV3', 'pizzaControlV2', 'pizzaControl'];

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
    apiKey: "AIzaSyAzrYsr6S2hMkgeG9ZOJ0MnkuT0V81a3rc",
    authDomain: "pizzacontrol-oficial.firebaseapp.com",
    projectId: "pizzacontrol-oficial",
    storageBucket: "pizzacontrol-oficial.firebasestorage.app",
    messagingSenderId: "1066316732970",
    appId: "1:1066316732970:web:617739279818c1ef698153"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const dbFirestore = firebase.firestore();
let firebaseUser = null;
let planoAtual = null; // 'basico' ou 'pro' — acesso vitalício, sem data de vencimento

// TROQUE aqui pelo link de vendas/checkout que você quer usar nos avisos de upgrade para PRO.
// Se quiser, pode trocar por um link direto de checkout do plano PRO específico.
const LINK_UPGRADE_PRO = 'https://pay.cakto.com.br/wx9esqb_1139423'; // Checkout Cakto: Upgrade PRO

const DB_PADRAO = {
    versao: 2,
    insumos: [],
    fichas: [],
    custos: {
        aluguel: 0,
        energia: 0,
        gas: 0,
        agua: 0,
        internet: 0,
        func: 0,
        gasolina: 0,
        emb: 0,
        mkt: 0,
        contador: 0,
        outros: 0,
        pizzas: 300
    },
    massa: {
        ingredientes: [],
        pesoTotal: 3000,
        pesoP: 200,
        pesoM: 300,
        pesoG: 400,
        pesoGG: 500
    },
    config: {
        nomePizzaria: '',
        meta: 15000
    },
    produtosProntos: [],
    // Taxas cobradas sobre o valor de cada venda (%) e meta de lucro real (%)
    taxas: { imposto: 0, cartao: 0, app: 0, vendasApp: 0, metaLucro: 15 }
};

let DB = clonar(DB_PADRAO);
let editandoFichaId = null;
let editandoProdutoId = null;
let filtroTam = 'all';

document.addEventListener('DOMContentLoaded', () => {
    // Enter na tela de login dispara o botão Entrar
    document.getElementById('loginSenha')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') fazerLoginFirebase();
    });
    document.getElementById('loginEmail')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('loginSenha')?.focus();
    });

    // Garantir redirecionamento limpo para a Landing Page sem intercepção local
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && (link.getAttribute('href') === '/' || link.getAttribute('href') === 'https://pizzacontrol.com.br')) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = 'https://pizzacontrol.com.br';
        }
    });

    // Observador de estado de autenticação Firebase
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            firebaseUser = null;
            mostrarTela('login');
            return;
        }
        firebaseUser = user;
        mostrarTela('loading');

        const valido = await verificarAssinatura(user.uid);
        if (!valido) {
            mostrarTela('expired');
            return;
        }

        // Assinatura válida — configurar storage e liberar o sistema
        configurarStorageUsuario(user.uid);
        mostrarTela('app');
        inicializarApp();
    });
});

window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;

    carregarDados();
    renderAll();
    loadMassaUI();
    loadCustosUI();
    loadConfigUI();
    refreshIngSelects();
    refreshMassaSelects();
    loadFichasSelect();
});

// ===== FIREBASE AUTH & ASSINATURA =====
function mostrarTela(tela) {
    document.getElementById('loadingScreen').style.display = tela === 'loading' ? 'flex' : 'none';
    document.getElementById('loginScreen').style.display = tela === 'login' ? 'flex' : 'none';
    document.getElementById('expiredScreen').style.display = tela === 'expired' ? 'flex' : 'none';
    document.getElementById('appContent').style.display = tela === 'app' ? '' : 'none';

    // Resetar botão de login ao exibir a tela (corrige bug pós-logout)
    if (tela === 'login') {
        const btn = document.getElementById('btnLogin');
        if (btn) { btn.disabled = false; btn.textContent = '🔑 Entrar'; }
        const erro = document.getElementById('loginErro');
        if (erro) erro.style.display = 'none';
    }
}

async function verificarAssinatura(uid) {
    // MODELO ATUAL: acesso vitalício por plano (Básico ou Pro), sem data de vencimento.
    // O campo "plano" é gravado automaticamente pela automação (Make) no momento da compra.
    // Se um dia você criar um produto por assinatura recorrente, adicione de volta a checagem
    // de "dataVencimento" apenas para documentos que tiverem tipo: 'assinatura'.
    try {
        const doc = await dbFirestore.collection('usuarios').doc(uid).get();
        if (!doc.exists) {
            console.warn('⚠️ Documento do usuário não encontrado no Firestore (acesso ainda não liberado):', uid);
            return false;
        }

        const dados = doc.data();
        // Só libera planos válidos. "reembolsado" (ou qualquer outro valor) = sem acesso.
        if (dados.plano !== 'basico' && dados.plano !== 'pro') {
            console.warn('⚠️ Plano sem acesso ativo para:', uid, '| plano =', dados.plano);
            return false;
        }

        isPro = dados.plano === 'pro';
        planoAtual = dados.plano;
        console.log(isPro ? '⭐ Plano: PRO (vitalício)' : '📋 Plano: BÁSICO (vitalício)');

        return true; // Documento existe com plano definido = compra confirmada = acesso liberado
    } catch (err) {
        console.error('❌ Erro ao verificar acesso:', err);
        return false;
    }
}

function configurarStorageUsuario(uid) {
    const chaveUsuario = STORAGE_KEY_BASE + '_' + uid;
    const chaveGenerica = STORAGE_KEY_BASE;

    // Migrar dados antigos (sem UID) para o PRIMEIRO usuário que fizer login.
    // Após migrar, a chave genérica é REMOVIDA para que novos usuários comecem limpos.
    if (!localStorage.getItem(chaveUsuario) && localStorage.getItem(chaveGenerica)) {
        localStorage.setItem(chaveUsuario, localStorage.getItem(chaveGenerica));
        localStorage.removeItem(chaveGenerica);
        console.log('📦 Dados migrados para o usuário:', uid, '| Chave genérica removida.');
    }

    STORAGE_KEY = chaveUsuario;

    // Criar PIN e sessão automaticamente (bypass legado)
    // Garante que nenhum código remanescente bloqueie o acesso do cliente
    if (!localStorage.getItem(PIN_MASTER_KEY)) {
        localStorage.setItem(PIN_MASTER_KEY, '000000');
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
        authenticated: true,
        unlockedAt: new Date().toISOString()
    }));
}

function inicializarApp() {
    carregarDados();
    setupNav();
    aplicarTravaPlanos();
    renderAll();
    loadMassaUI();
    loadCustosUI();
    loadConfigUI();

    if (document.getElementById('ficIngLista')) limparFicha();

    refreshIngSelects();
    refreshMassaSelects();
    loadFichasSelect();

    // Exibir info da conta na aba Config
    const contaEmail = document.getElementById('contaEmail');
    const contaVenc = document.getElementById('contaVencimento');
    if (contaEmail && firebaseUser) contaEmail.textContent = firebaseUser.email;
    if (contaVenc) {
        contaVenc.textContent = isPro ? '⭐ PRO (acesso vitalício)' : '📋 Básico (acesso vitalício)';
    }

    iniciarNuvem();
}

async function fazerLoginFirebase() {
    const email = document.getElementById('loginEmail').value.trim();
    const senha = document.getElementById('loginSenha').value;
    const btnLogin = document.getElementById('btnLogin');
    const erroDiv = document.getElementById('loginErro');

    if (!email || !senha) {
        erroDiv.textContent = '⚠️ Preencha e-mail e senha!';
        erroDiv.style.display = 'block';
        return;
    }

    btnLogin.disabled = true;
    btnLogin.textContent = '⏳ Entrando...';
    erroDiv.style.display = 'none';

    try {
        await auth.signInWithEmailAndPassword(email, senha);
        // onAuthStateChanged cuida do resto
    } catch (err) {
        btnLogin.disabled = false;
        btnLogin.textContent = '🔑 Entrar';

        const mensagens = {
            'auth/user-not-found': '❌ E-mail não encontrado.',
            'auth/wrong-password': '❌ Senha incorreta.',
            'auth/invalid-email': '❌ E-mail inválido.',
            'auth/too-many-requests': '⚠️ Muitas tentativas. Aguarde um momento.',
            'auth/invalid-credential': '❌ E-mail ou senha incorretos.',
            'auth/network-request-failed': '❌ Sem conexão com a internet.'
        };

        erroDiv.textContent = mensagens[err.code] || '❌ Erro: ' + err.message;
        erroDiv.style.display = 'block';
    }
}

function clonar(valor) {
    return JSON.parse(JSON.stringify(valor));
}

function gerarId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

function numero(valor, fallback = 0) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : fallback;
}

// ===== NUVEM (Firestore) =====
// Os dados ficam no aparelho (funciona sem internet) E numa cópia na conta do cliente.
// Vale sempre a versão alterada por último. Na primeira sincronização de um aparelho que
// já tem dados diferentes dos da nuvem, o cliente escolhe qual manter (a outra vira cópia).
const COLECAO_NUVEM = 'dadosClientes';
const VERSAO_APP = '3.4.0';
const LIMITE_NUVEM = 700000; // limite seguro de tamanho do documento
let nuvemPronta = false;
let nuvemTimer = null;
let nuvemUnsub = null;
let nuvemEstado = 'local';

function idDispositivo() {
    let id = localStorage.getItem('pcDispositivo');
    if (!id) {
        id = gerarId();
        localStorage.setItem('pcDispositivo', id);
    }
    return id;
}

function refNuvem() {
    return firebaseUser ? dbFirestore.collection(COLECAO_NUVEM).doc(firebaseUser.uid) : null;
}

function chaveSincronizado() {
    return 'pcSincronizado_' + (firebaseUser ? firebaseUser.uid : '');
}

function mostrarEstadoNuvem(estado) {
    nuvemEstado = estado;
    const el = document.getElementById('nuvemStatus');
    if (!el) return;
    const textos = {
        sincronizando: '⏳',
        salvo: '✅ Salvo',
        offline: '📴 Offline',
        erro: '⚠️ Erro',
        local: '…'
    };
    el.textContent = textos[estado] || '…';
    const box = document.getElementById('nuvemBox');
    if (box) box.title = explicacaoNuvem();
}

function explicacaoNuvem() {
    return {
        sincronizando: 'Enviando suas alterações para a nuvem...',
        salvo: 'Tudo salvo na nuvem. Seus dados aparecem em qualquer aparelho com o seu login.',
        offline: 'Sem internet. Suas alterações estão salvas neste aparelho e vão para a nuvem quando a conexão voltar.',
        erro: 'Não foi possível salvar na nuvem agora. Suas alterações estão salvas neste aparelho e o sistema vai tentar de novo.',
        local: 'Conectando à nuvem...'
    }[nuvemEstado] || '';
}

function temDados(d) {
    if (!d) return false;
    const c = d.custos || {};
    const custos = ['aluguel', 'energia', 'gas', 'agua', 'internet', 'func', 'gasolina', 'emb', 'mkt', 'contador', 'outros'].some((k) => numero(c[k]) > 0);
    return (d.insumos || []).length > 0 || (d.fichas || []).length > 0 || (d.produtosProntos || []).length > 0 ||
        ((d.massa && d.massa.ingredientes) || []).length > 0 || custos;
}

function conteudoIgual(a, b) {
    const limpar = (d) => JSON.stringify({ ...d, atualizadoEm: 0 });
    return limpar(a) === limpar(b);
}

function resumoDados(d) {
    const n = (qtd, um, varios) => qtd + ' ' + (qtd === 1 ? um : varios);
    return n((d.insumos || []).length, 'insumo', 'insumos') + ', ' + n((d.fichas || []).length, 'ficha', 'fichas');
}

function dataAlteracao(ts) {
    return numero(ts) > 1e12 ? 'salva em ' + new Date(numero(ts)).toLocaleString('pt-BR') : 'data não registrada';
}

function agendarSalvarNuvem() {
    if (!nuvemPronta || !firebaseUser) return;
    clearTimeout(nuvemTimer);
    mostrarEstadoNuvem('sincronizando');
    nuvemTimer = setTimeout(salvarNuvemAgora, 1500);
}

async function salvarNuvemAgora() {
    clearTimeout(nuvemTimer);
    nuvemTimer = null;
    const ref = refNuvem();
    if (!nuvemPronta || !ref) return false;

    const json = JSON.stringify(DB);
    if (json.length > LIMITE_NUVEM) {
        mostrarEstadoNuvem('erro');
        status('⚠️ Seus dados ficaram grandes demais para a nuvem. Eles continuam salvos neste aparelho. Fale com o suporte.', true);
        return false;
    }
    if (!navigator.onLine) {
        mostrarEstadoNuvem('offline');
        return false;
    }

    mostrarEstadoNuvem('sincronizando');
    try {
        await ref.set({
            db: json,
            atualizadoEm: DB.atualizadoEm || Date.now(),
            dispositivo: idDispositivo(),
            versaoApp: VERSAO_APP
        });
        localStorage.setItem(chaveSincronizado(), '1');
        mostrarEstadoNuvem('salvo');
        return true;
    } catch (err) {
        console.error('Erro ao salvar na nuvem:', err);
        mostrarEstadoNuvem(navigator.onLine ? 'erro' : 'offline');
        return false;
    }
}

function aplicarDadosDaNuvem(json, atualizadoEm) {
    DB = normalizarDados(JSON.parse(json));
    DB.atualizadoEm = atualizadoEm;
    persistirDados(false, undefined, false);
    renderAll();
    loadMassaUI();
    loadCustosUI();
    loadConfigUI();
    refreshIngSelects();
    refreshMassaSelects();
    loadFichasSelect();
}

function guardarCopia(d, origem) {
    try {
        localStorage.setItem(STORAGE_KEY + '_copia_' + origem + '_' + Date.now(), JSON.stringify(d));
    } catch (e) {
        console.warn('Não foi possível guardar a cópia:', e);
    }
}

function perguntarQualManter(local, nuvem) {
    return new Promise((resolve) => {
        const dataNuvem = dataAlteracao(nuvem.atualizadoEm);
        const dataLocal = dataAlteracao(local.atualizadoEm);
        fecharModalUpgrade();
        const overlay = document.createElement('div');
        overlay.id = 'modalUpgradePro';
        overlay.className = 'mup-overlay';
        overlay.innerHTML = `
            <div class="mup-card" role="dialog" aria-modal="true" aria-labelledby="escolhaTitulo">
                <div class="mup-topo" style="background:linear-gradient(135deg,#1565c0,#0d47a1)">
                    <div class="mup-cadeado">☁️</div>
                    <h2 id="escolhaTitulo" class="mup-titulo">Qual versão dos seus dados você quer usar?</h2>
                </div>
                <div class="mup-corpo">
                    <p class="mup-texto">Agora seus dados ficam salvos na nuvem e aparecem em todos os seus aparelhos. Encontramos duas versões diferentes:</p>
                    <button type="button" class="mup-cta" id="escolhaNuvem" style="width:100%;border:0;cursor:pointer;margin-bottom:10px;text-align:left">☁️ Da nuvem<br><small style="font-weight:600">${esc(resumoDados(nuvem))} · ${esc(dataNuvem)}</small></button>
                    <button type="button" class="mup-cta" id="escolhaLocal" style="width:100%;border:0;cursor:pointer;text-align:left;background:linear-gradient(135deg,#455a64,#263238)">📱 Deste aparelho<br><small style="font-weight:600">${esc(resumoDados(local))} · ${esc(dataLocal)}</small></button>
                    <p class="mup-rodape">A versão que você não escolher fica guardada como cópia neste aparelho. Nada é apagado.</p>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#escolhaNuvem').addEventListener('click', () => { overlay.remove(); resolve('nuvem'); });
        overlay.querySelector('#escolhaLocal').addEventListener('click', () => { overlay.remove(); resolve('local'); });
    });
}

async function iniciarNuvem() {
    pararNuvem();
    const ref = refNuvem();
    if (!ref) return;
    mostrarEstadoNuvem('local');

    let doc;
    try {
        doc = await ref.get();
    } catch (err) {
        console.error('Erro ao buscar dados da nuvem:', err);
        mostrarEstadoNuvem(navigator.onLine ? 'erro' : 'offline');
        // Tenta de novo quando a internet voltar
        window.addEventListener('online', iniciarNuvem, { once: true });
        return;
    }

    const local = clonar(DB);
    const jaSincronizou = localStorage.getItem(chaveSincronizado()) === '1';

    if (!doc.exists) {
        nuvemPronta = true;
        if (temDados(local)) await salvarNuvemAgora();
        else { localStorage.setItem(chaveSincronizado(), '1'); mostrarEstadoNuvem('salvo'); }
    } else {
        const dados = doc.data();
        let nuvem;
        try {
            nuvem = normalizarDados(JSON.parse(dados.db));
        } catch (e) {
            console.error('Dados da nuvem inválidos:', e);
            nuvemPronta = true;
            await salvarNuvemAgora();
            ouvirNuvem();
            return;
        }
        nuvem.atualizadoEm = numero(dados.atualizadoEm);

        if (!temDados(local) || conteudoIgual(local, nuvem)) {
            aplicarDadosDaNuvem(dados.db, nuvem.atualizadoEm);
            localStorage.setItem(chaveSincronizado(), '1');
            nuvemPronta = true;
            mostrarEstadoNuvem('salvo');
        } else if (jaSincronizou) {
            nuvemPronta = true;
            if (nuvem.atualizadoEm > numero(local.atualizadoEm)) {
                aplicarDadosDaNuvem(dados.db, nuvem.atualizadoEm);
                mostrarEstadoNuvem('salvo');
            } else if (numero(local.atualizadoEm) > nuvem.atualizadoEm) {
                await salvarNuvemAgora(); // alterações feitas sem internet
            } else {
                mostrarEstadoNuvem('salvo');
            }
        } else if (!temDados(nuvem)) {
            nuvemPronta = true;
            await salvarNuvemAgora();
        } else {
            const escolha = await perguntarQualManter(local, nuvem);
            if (escolha === 'nuvem') {
                guardarCopia(local, 'aparelho');
                aplicarDadosDaNuvem(dados.db, nuvem.atualizadoEm);
                localStorage.setItem(chaveSincronizado(), '1');
                nuvemPronta = true;
                mostrarEstadoNuvem('salvo');
                status('☁️ Usando os dados da nuvem. A versão deste aparelho foi guardada como cópia.');
            } else {
                guardarCopia(nuvem, 'nuvem');
                nuvemPronta = true;
                persistirDados(false); // marca como a versão mais recente
                await salvarNuvemAgora();
                status('📱 Usando os dados deste aparelho. A versão da nuvem foi guardada como cópia.');
            }
        }
    }

    ouvirNuvem();
}

// Recebe na hora as alterações feitas em outro aparelho
function ouvirNuvem() {
    const ref = refNuvem();
    if (!ref || nuvemUnsub) return;
    nuvemUnsub = ref.onSnapshot((doc) => {
        if (!doc.exists || (doc.metadata && doc.metadata.hasPendingWrites)) return;
        const d = doc.data();
        if (d.dispositivo === idDispositivo()) return;
        if (numero(d.atualizadoEm) > numero(DB.atualizadoEm) && !nuvemTimer) {
            try {
                aplicarDadosDaNuvem(d.db, numero(d.atualizadoEm));
                mostrarEstadoNuvem('salvo');
                status('🔄 Dados atualizados com as mudanças feitas em outro aparelho.');
            } catch (e) {
                console.error('Erro ao aplicar dados da nuvem:', e);
            }
        }
    }, (err) => {
        console.error('Erro ao ouvir a nuvem:', err);
    });
}

function pararNuvem() {
    if (nuvemUnsub) {
        try { nuvemUnsub(); } catch (e) {}
    }
    nuvemUnsub = null;
    nuvemPronta = false;
    clearTimeout(nuvemTimer);
    nuvemTimer = null;
}

window.addEventListener('online', () => {
    if (nuvemPronta && nuvemEstado !== 'salvo') salvarNuvemAgora();
});
window.addEventListener('offline', () => {
    if (nuvemPronta) mostrarEstadoNuvem('offline');
});

// ===== FORMATAÇÃO, SEGURANÇA E UNIDADES =====
function brl(v) {
    return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(v, casas = 1) {
    return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Versão 2 dos dados: quantidades SEMPRE na unidade base (g, ml ou un).
// Insumo comprado em kg ou L tem o custo convertido para grama ou mililitro.
const VERSAO_DADOS = 2;
const FATOR_UNIDADE = { kg: 1000, L: 1000 };

function fatorUnidade(un) {
    return FATOR_UNIDADE[un] || 1;
}

function unidadeBase(un) {
    if (un === 'kg') return 'g';
    if (un === 'L') return 'ml';
    return un || 'g';
}

function calcCustoUnBase(precoEmb, qtdEmb, un) {
    const base = numero(qtdEmb) * fatorUnidade(un);
    return base > 0 ? numero(precoEmb) / base : 0;
}

function custoNaUnidadeCompra(ins) {
    return (ins.custoUn || 0) * fatorUnidade(ins.unidade);
}

function atualizarUnidadeLinha(sel) {
    const linha = sel.closest('.ingrediente-item, .massa-item');
    if (!linha) return;
    const ins = DB.insumos.find((i) => i.id == sel.value);
    linha.querySelectorAll('.qtd-un').forEach((span) => { span.textContent = ins ? unidadeBase(ins.unidade) : ''; });
}

function validarFormatoPin(pin) {
    return /^\d{4,6}$/.test(pin);
}

function obterPinMaster() {
    const pin = localStorage.getItem(PIN_MASTER_KEY);
    if (!pin) return '';
    return /^\d{4,6}$/.test(pin) ? pin : '';
}

function normalizarPalavraChave(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function gerarHashRecuperacao(chave) {
    const base = 'pc-recovery-v1::' + normalizarPalavraChave(chave);
    let hashA = 2166136261;
    let hashB = 2654435761;

    for (let i = 0; i < base.length; i++) {
        const code = base.charCodeAt(i);
        hashA ^= code;
        hashA = Math.imul(hashA, 16777619);

        hashB ^= code + i;
        hashB = Math.imul(hashB, 2246822519);
    }

    const partA = (hashA >>> 0).toString(16).padStart(8, '0');
    const partB = (hashB >>> 0).toString(16).padStart(8, '0');
    const mix = (partA + partB).split('').reverse().join('');
    return 'obf:' + partA + partB + mix;
}

function validarSessao() {
    // Autenticação agora é feita pelo Firebase Auth
    // Esta função é mantida como no-op para compatibilidade
    return true;
}

function normalizarDados(raw) {
    const origem = raw || {};

    const insumos = Array.isArray(origem.insumos)
        ? origem.insumos.map((i) => {
              const qtdEmb = numero(i.qtdEmb);
              const precoEmb = numero(i.precoEmb);
              const unidade = i.unidade || 'g';
              const custoUn = calcCustoUnBase(precoEmb, qtdEmb, unidade);
              return {
                  id: String(i.id || gerarId()),
                  nome: (i.nome || '').trim(),
                  categoria: i.categoria || 'Outros',
                  unidade,
                  qtdEmb,
                  precoEmb,
                  custoUn
              };
          })
        : [];

    const fichas = Array.isArray(origem.fichas)
        ? origem.fichas.map((f) => ({
              id: String(f.id || gerarId()),
              grupoId: f.grupoId ? String(f.grupoId) : '',
              nome: f.nome || '',
              categoria: f.categoria || 'Tradicional',
              tamanho: f.tamanho || 'G',
              precoVenda: numero(f.precoVenda),
              incMassa: f.incMassa !== false,
              ingredientes: Array.isArray(f.ingredientes)
                  ? f.ingredientes.map((ing) => ({
                        insumoId: String(ing.insumoId || ''),
                        nome: ing.nome || '',
                        quantidade: numero(ing.quantidade),
                        unidade: ing.unidade || 'g',
                        custo: numero(ing.custo)
                    }))
                  : [],
              custoIng: numero(f.custoIng),
              custoMassa: numero(f.custoMassa),
              custoFixo: numero(f.custoFixo),
              custoTotal: numero(f.custoTotal),
              lucro: numero(f.lucro),
              cmv: numero(f.cmv)
          }))
        : [];

    const custosOrigem = origem.custos || origem.custosFixos || {};
    const custos = {
        aluguel: numero(custosOrigem.aluguel),
        energia: numero(custosOrigem.energia),
        gas: numero(custosOrigem.gas),
        agua: numero(custosOrigem.agua),
        internet: numero(custosOrigem.internet),
        func: numero(custosOrigem.func, numero(custosOrigem.funcionarios)),
        gasolina: numero(custosOrigem.gasolina),
        emb: numero(custosOrigem.emb, numero(custosOrigem.embalagens)),
        mkt: numero(custosOrigem.mkt, numero(custosOrigem.marketing)),
        contador: numero(custosOrigem.contador),
        outros: numero(custosOrigem.outros),
        pizzas: numero(custosOrigem.pizzas, numero(custosOrigem.pizzasMes, 300)) || 300
    };

    const massaOrigem = origem.massa || {};
    const massa = {
        ingredientes: Array.isArray(massaOrigem.ingredientes)
            ? massaOrigem.ingredientes.map((ing) => ({
                  insumoId: String(ing.insumoId || ''),
                  quantidade: numero(ing.quantidade)
              }))
            : [],
        pesoTotal: numero(massaOrigem.pesoTotal, numero(massaOrigem.rendimento) * 300 || 3000) || 3000,
        pesoP: numero(massaOrigem.pesoP, 200) || 200,
        pesoM: numero(massaOrigem.pesoM, 300) || 300,
        pesoG: numero(massaOrigem.pesoG, 400) || 400,
        pesoGG: numero(massaOrigem.pesoGG, 500) || 500
    };

    const configOrigem = origem.config || {};
    const config = {
        nomePizzaria: (configOrigem.nomePizzaria || '').trim(),
        meta: numero(configOrigem.meta, 15000) || 15000
    };

    const produtosProntos = Array.isArray(origem.produtosProntos)
        ? origem.produtosProntos.map((p) => ({
              id: String(p.id || gerarId()),
              nome: (p.nome || '').trim(),
              categoria: p.categoria || 'Bebida',
              precoCusto: numero(p.precoCusto),
              precoVenda: numero(p.precoVenda),
              lucro: numero(p.lucro, numero(p.precoVenda) - numero(p.precoCusto))
          }))
        : [];

    // MIGRAÇÃO v1 -> v2: antes, a quantidade de um insumo comprado em kg/L era digitada em kg/L.
    // Agora é sempre em g/ml. Valores abaixo de 50 só fazem sentido em kg/L, então são convertidos.
    // Valores a partir de 50 já estavam em gramas (o custo aparecia absurdo) e ficam como estão.
    if (numero(origem.versao) < VERSAO_DADOS) {
        const unidadePorId = {};
        insumos.forEach((i) => { unidadePorId[i.id] = i.unidade; });
        const converter = (ing) => {
            const fator = fatorUnidade(unidadePorId[ing.insumoId]);
            if (fator > 1 && ing.quantidade > 0 && ing.quantidade < 50) ing.quantidade = ing.quantidade * fator;
        };
        fichas.forEach((f) => f.ingredientes.forEach(converter));
        massa.ingredientes.forEach(converter);
    }
    fichas.forEach((f) => f.ingredientes.forEach((ing) => {
        const ins = insumos.find((i) => i.id === ing.insumoId);
        if (ins) ing.unidade = unidadeBase(ins.unidade);
    }));

    const tx = origem.taxas || {};
    const limitar = (v, max) => Math.min(Math.max(numero(v), 0), max);
    const taxas = {
        imposto: limitar(tx.imposto, 60),
        cartao: limitar(tx.cartao, 30),
        app: limitar(tx.app, 50),
        vendasApp: limitar(tx.vendasApp, 100),
        metaLucro: tx.metaLucro === undefined ? 15 : limitar(tx.metaLucro, 80)
    };

    return { versao: VERSAO_DADOS, atualizadoEm: Math.round(numero(origem.atualizadoEm)), insumos, fichas, custos, massa, config, produtosProntos, taxas };
}

function obterPrimeiroValor(keys) {
    for (const key of keys) {
        const valor = localStorage.getItem(key);
        if (valor) return { key, valor };
    }
    return null;
}

function carregarDados() {
    const encontrado = obterPrimeiroValor([STORAGE_KEY, ...LEGACY_KEYS]);

    if (!encontrado) {
        DB = clonar(DB_PADRAO);
        persistirDados(false, undefined, false);
        return;
    }

    try {
        const raw = JSON.parse(encontrado.valor);
        DB = normalizarDados(raw);

        if (encontrado.key !== STORAGE_KEY || numero(raw.versao) < VERSAO_DADOS) {
            persistirDados(false, undefined, false);
        }
    } catch (err) {
        console.error('Erro ao carregar dados locais:', err);
        try { localStorage.setItem(STORAGE_KEY + '_corrompido_' + Date.now(), encontrado.valor); } catch (e) {}
        DB = clonar(DB_PADRAO);
        persistirDados(false, undefined, false);
    }
}

function persistirDados(mostrarStatus = true, mensagem = '💾 Dados salvos!', marcarAlteracao = true) {
    try {
        if (marcarAlteracao) DB.atualizadoEm = Date.now();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
        if (mostrarStatus) status(mensagem);
        if (marcarAlteracao) agendarSalvarNuvem();
        return true;
    } catch (err) {
        console.error('Falha ao salvar localStorage:', err);
        if (mostrarStatus) status('❌ Não foi possível salvar no navegador!', true);
        return false;
    }
}

function salvarDados() {
    persistirDados(true);
}

async function fazerLogout() {
    await salvarNuvemAgora();
    pararNuvem();
    auth.signOut();
    // onAuthStateChanged mostra a tela de login automaticamente
}

function alterarSenha() {
    const pinAtual = document.getElementById('pinAtual').value.trim();
    const novoPin = document.getElementById('novaSenha').value.trim();
    const conf = document.getElementById('confSenha').value.trim();
    const novaRecuperacaoRaw = document.getElementById('novaRecuperacao')?.value || '';
    const novaRecuperacao = normalizarPalavraChave(novaRecuperacaoRaw);
    const pinSalvo = obterPinMaster();

    if (!pinSalvo) {
        alert('⚠️ PIN master não encontrado. Acesse novamente pela tela inicial para criar um novo PIN.');
        return;
    }

    if (pinAtual !== pinSalvo) {
        alert('⚠️ PIN atual incorreto!');
        return;
    }

    if (!validarFormatoPin(novoPin)) {
        alert('⚠️ O novo PIN deve ter de 4 a 6 números!');
        return;
    }

    if (novoPin !== conf) {
        alert('⚠️ Os PINs não conferem!');
        return;
    }

    if (novoPin === pinAtual) {
        alert('⚠️ O novo PIN deve ser diferente do PIN atual!');
        return;
    }

    if (novaRecuperacaoRaw.trim() && novaRecuperacao.length < 3) {
        alert('⚠️ A palavra-chave de recuperação deve ter ao menos 3 caracteres!');
        return;
    }

    localStorage.setItem(PIN_MASTER_KEY, novoPin);
    if (novaRecuperacaoRaw.trim()) {
        localStorage.setItem(RECOVERY_HASH_KEY, gerarHashRecuperacao(novaRecuperacao));
    }

    document.getElementById('pinAtual').value = '';
    document.getElementById('novaSenha').value = '';
    document.getElementById('confSenha').value = '';
    const campoRecuperacao = document.getElementById('novaRecuperacao');
    if (campoRecuperacao) campoRecuperacao.value = '';

    if (novaRecuperacaoRaw.trim()) {
        alert('✅ PIN e palavra-chave de recuperação atualizados com sucesso!');
    } else {
        alert('✅ PIN alterado com sucesso!');
    }
}

function status(msg, error = false) {
    const bar = document.getElementById('statusBar');
    if (!bar) return;

    bar.textContent = msg;
    bar.className = 'status-bar show' + (error ? ' error' : '');
    setTimeout(() => bar.classList.remove('show'), 2500);
}

function testarStorage() {
    try {
        localStorage.setItem('_test', '1');
        localStorage.removeItem('_test');
        status('✅ Storage OK! ' + DB.insumos.length + ' insumos, ' + DB.fichas.length + ' fichas');
    } catch (e) {
        status('❌ Storage não funciona!', true);
    }
}

function renderAll() {
    renderHeader();
    renderInsumos();
    renderFichas();
    renderProdutosProntos();
    renderDashboard();
}

function renderHeader() {
    const hdrInsumos = document.getElementById('hdrInsumos');
    const hdrFichas = document.getElementById('hdrFichas');
    const hdrCustoFixo = document.getElementById('hdrCustoFixo');

    if (hdrInsumos) hdrInsumos.textContent = DB.insumos.length;
    if (hdrFichas) hdrFichas.textContent = DB.fichas.length;
    if (hdrCustoFixo) hdrCustoFixo.textContent = brl(calcularCustoFixoPorPizza());
}

function sincronizarUI() {
    renderHeader();
    renderInsumos();
    refreshIngSelects();
    refreshMassaSelects();
    renderFichas();
    renderProdutosProntos();
    renderDashboard();
    loadFichasSelect();
}

// ===== HAMBURGER MENU =====
function toggleMenu() {
    const nav = document.getElementById('navTabs');
    const overlay = document.getElementById('menuOverlay');
    if (nav.classList.contains('open')) {
        nav.classList.remove('open');
        overlay.classList.remove('show');
    } else {
        nav.classList.add('open');
        overlay.classList.add('show');
    }
}

let navConfigurado = false;
function setupNav() {
    if (navConfigurado) return; // evita listeners duplicados se a pessoa sair e entrar de novo
    navConfigurado = true;
    document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('page-' + tab.dataset.page).classList.add('active');
            if (tab.dataset.page === 'nova-ficha') { refreshIngSelects(); calcFicha(); }
            if (tab.dataset.page === 'massa') {
                refreshMassaSelects();
                calcMassa();
            }
            if (tab.dataset.page === 'precificar') {
                loadFichasSelect();
                loadFichasSelectMeioAMeio();
                loadComboSelects();
                calcMeioAMeio();
                calcCombo();
            }
            if (tab.dataset.page === 'produtos') renderProdutosProntos();
            if (tab.dataset.page === 'fichas') renderFichas();
            if (tab.dataset.page === 'dashboard') renderDashboard();

            if (window.innerWidth <= 768) {
                document.getElementById('navTabs').classList.remove('open');
                document.getElementById('menuOverlay').classList.remove('show');
            }
        });
    });
}

// ===== INSUMOS =====
function abrirModalInsumo(id = null) {
    document.getElementById('modalIns').classList.add('show');
    document.getElementById('insId').value = '';
    document.getElementById('insNome').value = '';
    document.getElementById('insQtd').value = '';
    document.getElementById('insPreco').value = '';
    document.getElementById('modalInsTitle').textContent = '📦 Novo Insumo';

    if (id) {
        const ins = DB.insumos.find((i) => i.id === id);
        if (ins) {
            document.getElementById('insId').value = id;
            document.getElementById('insNome').value = ins.nome;
            document.getElementById('insCat').value = ins.categoria;
            document.getElementById('insUn').value = ins.unidade;
            document.getElementById('insQtd').value = ins.qtdEmb;
            document.getElementById('insPreco').value = ins.precoEmb;
            document.getElementById('modalInsTitle').textContent = '✏️ Editar Insumo';
        }
    }
}

function fecharModal(id) {
    document.getElementById(id).classList.remove('show');
}

function salvarInsumo() {
    const nome = document.getElementById('insNome').value.trim();
    const cat = document.getElementById('insCat').value;
    const un = document.getElementById('insUn').value;
    const qtd = parseFloat(document.getElementById('insQtd').value) || 0;
    const preco = parseFloat(document.getElementById('insPreco').value) || 0;
    const editId = document.getElementById('insId').value;

    if (!nome || !qtd || !preco) {
        alert('⚠️ Preencha todos os campos!');
        return;
    }

    const custoUn = calcCustoUnBase(preco, qtd, un);
    const insAntigo = editId ? DB.insumos.find((i) => i.id === editId) : null;
    const custoAntigo = insAntigo ? insAntigo.custoUn || 0 : 0;
    const antes = {};
    if (insAntigo) {
        DB.fichas.forEach((f) => {
            atualizarCustosDaFicha(f);
            antes[f.id] = { lucro: f.lucro, custo: f.custoTotal, margem: f.margemReal };
        });
    }
    const insumoData = {
        id: editId || gerarId(),
        nome,
        categoria: cat,
        unidade: un,
        qtdEmb: qtd,
        precoEmb: preco,
        custoUn
    };

    if (editId) {
        const idx = DB.insumos.findIndex((i) => i.id === editId);
        if (idx !== -1) DB.insumos[idx] = insumoData;
        status('💾 Atualizado!');
    } else {
        DB.insumos.push(insumoData);
        status('💾 Salvo!');
    }

    persistirDados(false);
    fecharModal('modalIns');
    sincronizarUI();

    if (insAntigo && custoAntigo > 0 && Math.abs(custoUn - custoAntigo) / custoAntigo > 0.001) {
        mostrarAvisoMudancaPreco(insumoData, custoAntigo, antes);
    }
}

function mostrarAvisoMudancaPreco(ins, custoAntigo, antes) {
    const afetadas = DB.fichas
        .filter((f) => antes[f.id] && Math.abs(f.custoTotal - antes[f.id].custo) > 0.004)
        .map((f) => ({ f, antes: antes[f.id] }));
    if (afetadas.length === 0) return;

    const variacao = ((ins.custoUn - custoAntigo) / custoAntigo) * 100;
    const subiu = variacao > 0;
    const meta = metaLucroFracao() * 100;
    const caiuAbaixo = isPro ? afetadas.filter((a) => a.antes.margem >= meta - 0.05 && a.f.margemReal < meta - 0.05).length : 0;
    const abaixoTotal = isPro ? DB.fichas.filter((f) => f.margemReal < meta - 0.05).length : 0;
    const somaDif = afetadas.reduce((acc, a) => acc + (a.f.lucro - a.antes.lucro), 0);

    const linhas = afetadas.sort((a, b) => (a.f.lucro - a.antes.lucro) - (b.f.lucro - b.antes.lucro)).slice(0, 6).map((a) =>
        `<li style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #eee"><span>${esc(a.f.nome)} (${a.f.tamanho})</span><span style="white-space:nowrap">${brl(a.antes.lucro)} → <b style="color:${a.f.lucro < a.antes.lucro ? '#c62828' : '#2e7d32'}">${brl(a.f.lucro)}</b></span></li>`
    ).join('');

    fecharModalUpgrade();
    const overlay = document.createElement('div');
    overlay.id = 'modalUpgradePro';
    overlay.className = 'mup-overlay';
    overlay.innerHTML = `
        <div class="mup-card" role="dialog" aria-modal="true" aria-labelledby="avisoPrecoTitulo">
            <button type="button" class="mup-fechar" aria-label="Fechar">✕</button>
            <div class="mup-topo" style="${subiu ? '' : 'background:linear-gradient(135deg,#2e7d32,#1b5e20)'}">
                <div class="mup-cadeado">${subiu ? '📈' : '📉'}</div>
                <h2 id="avisoPrecoTitulo" class="mup-titulo">${esc(ins.nome)} ${subiu ? 'subiu' : 'baixou'} ${pct(Math.abs(variacao))}</h2>
            </div>
            <div class="mup-corpo">
                <p class="mup-texto"><strong>${afetadas.length} ${afetadas.length === 1 ? 'pizza foi afetada' : 'pizzas foram afetadas'}.</strong> Vendendo uma de cada, você passa a lucrar ${brl(Math.abs(somaDif))} ${somaDif < 0 ? 'a menos' : 'a mais'}.</p>
                <ul style="list-style:none;padding:0;margin:0 0 14px;font-size:0.9rem">${linhas}</ul>
                ${afetadas.length > 6 ? `<p style="font-size:0.8rem;color:#777;margin:-6px 0 12px">e mais ${afetadas.length - 6}.</p>` : ''}
                ${isPro && abaixoTotal > 0 ? `<div class="mup-email" style="margin-bottom:14px"><div class="mup-email-titulo">⚠️ ${caiuAbaixo > 0 ? caiuAbaixo + (caiuAbaixo === 1 ? ' pizza ficou' : ' pizzas ficaram') + ' abaixo da sua meta agora. ' : ''}${abaixoTotal} no total ${abaixoTotal === 1 ? 'está' : 'estão'} abaixo da meta de ${pct(meta, 0)}.</div></div>
                <button type="button" class="mup-cta" id="avisoVerMeta" style="width:100%;border:0;cursor:pointer">VER O PREÇO CERTO DE CADA UMA</button>` : ''}
                <button type="button" class="mup-depois">Ok, entendi</button>
            </div>
        </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModalUpgrade(); });
    overlay.querySelector('.mup-fechar').addEventListener('click', fecharModalUpgrade);
    overlay.querySelector('.mup-depois').addEventListener('click', fecharModalUpgrade);
    const btnMeta = overlay.querySelector('#avisoVerMeta');
    if (btnMeta) btnMeta.addEventListener('click', () => {
        fecharModalUpgrade();
        document.querySelector('.nav-tab[data-page="dashboard"]')?.click();
        setTimeout(() => document.getElementById('cardMeta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    });
    document.addEventListener('keydown', fecharModalUpgradeEsc);
    document.body.appendChild(overlay);
}

function excluirInsumo(id) {
    const ins = DB.insumos.find((i) => i.id === id);
    const fichasUsando = DB.fichas.filter((f) => (f.ingredientes || []).some((ing) => ing.insumoId === id));
    const naMassa = (DB.massa.ingredientes || []).some((ing) => ing.insumoId === id);
    let aviso = 'Excluir "' + (ins ? ins.nome : 'insumo') + '"?';
    if (fichasUsando.length || naMassa) {
        aviso += '\n\n⚠️ Ele será retirado de:';
        if (naMassa) aviso += '\n• Receita da massa';
        fichasUsando.slice(0, 10).forEach((f) => { aviso += '\n• ' + f.nome + ' (' + f.tamanho + ')'; });
        if (fichasUsando.length > 10) aviso += '\n• e mais ' + (fichasUsando.length - 10) + ' fichas';
        aviso += '\n\nO custo dessas pizzas vai mudar.';
    }
    if (!confirm(aviso)) return;

    DB.insumos = DB.insumos.filter((i) => i.id !== id);
    DB.massa.ingredientes = (DB.massa.ingredientes || []).filter((ing) => ing.insumoId !== id);
    DB.fichas.forEach((f) => {
        if (Array.isArray(f.ingredientes)) {
            f.ingredientes = f.ingredientes.filter((ing) => ing.insumoId !== id);
        }
    });

    persistirDados(false);
    loadMassaUI();
    sincronizarUI();
    status('🗑️ Excluído!');
}

function renderInsumos() {
    const tbody = document.getElementById('tblInsumos');
    if (!tbody) return;

    if (DB.insumos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty"><div class="icon">📦</div>Nenhum insumo</td></tr>';
        return;
    }

    tbody.innerHTML = DB.insumos
        .map(
            (i) =>
                `<tr><td><strong>${esc(i.nome)}</strong></td><td><span class="badge badge-info">${esc(i.categoria)}</span></td><td>${esc(i.unidade)}</td><td>${String(i.qtdEmb).replace('.', ',')}</td><td>${brl(i.precoEmb)}</td><td><strong style="color:var(--primary)">${brl(custoNaUnidadeCompra(i))}/${esc(i.unidade)}</strong></td><td class="actions"><button class="btn btn-info btn-sm" onclick="abrirModalInsumo('${i.id}')">✏️</button><button class="btn btn-danger btn-sm" onclick="excluirInsumo('${i.id}')">🗑️</button></td></tr>`
        )
        .join('');
}

function iniciarListenerInsumos() {
    carregarDados();
    renderAll();
    loadMassaUI();
    loadCustosUI();
}

function filtrarInsumos() {
    const busca = document.getElementById('buscaIns').value.toLowerCase();
    document.querySelectorAll('#tblInsumos tr').forEach((tr) => {
        tr.style.display = tr.textContent.toLowerCase().includes(busca) ? '' : 'none';
    });
}

document.getElementById('insQtd')?.addEventListener('input', previewInsumo);
document.getElementById('insPreco')?.addEventListener('input', previewInsumo);
function previewInsumo() {
    const qtd = parseFloat(document.getElementById('insQtd').value) || 0;
    const preco = parseFloat(document.getElementById('insPreco').value) || 0;
    const un = document.getElementById('insUn').value;
    document.getElementById('insPreview').innerHTML =
        qtd > 0 && preco > 0
            ? '💡 Custo: <strong>' + brl(preco / qtd) + '</strong>/' + un + (fatorUnidade(un) > 1 ? ' (nas fichas você digita em ' + unidadeBase(un) + ')' : '')
            : '💡 Preencha para ver';
}

// ===== CUSTOS FIXOS =====
function loadCustosUI() {
    const c = DB.custos;
    document.getElementById('cfAluguel').value = c.aluguel || '';
    document.getElementById('cfEnergia').value = c.energia || '';
    document.getElementById('cfGas').value = c.gas || '';
    document.getElementById('cfAgua').value = c.agua || '';
    document.getElementById('cfInternet').value = c.internet || '';
    document.getElementById('cfFunc').value = c.func || '';
    document.getElementById('cfGasolina').value = c.gasolina || '';
    document.getElementById('cfEmb').value = c.emb || '';
    document.getElementById('cfMkt').value = c.mkt || '';
    document.getElementById('cfContador').value = c.contador || '';
    document.getElementById('cfOutros').value = c.outros || '';
    document.getElementById('cfPizzas').value = c.pizzas || 300;
    calcCustos();
    loadTaxasUI();
}

function loadConfigUI() {
    const nome = document.getElementById('configNome');
    const meta = document.getElementById('configMeta');
    if (nome) nome.value = DB.config.nomePizzaria || '';
    if (meta) meta.value = DB.config.meta || 15000;
}

function calcCustos() {
    const vals = {
        aluguel: parseFloat(document.getElementById('cfAluguel').value) || 0,
        energia: parseFloat(document.getElementById('cfEnergia').value) || 0,
        gas: parseFloat(document.getElementById('cfGas').value) || 0,
        agua: parseFloat(document.getElementById('cfAgua').value) || 0,
        internet: parseFloat(document.getElementById('cfInternet').value) || 0,
        func: parseFloat(document.getElementById('cfFunc').value) || 0,
        gasolina: parseFloat(document.getElementById('cfGasolina').value) || 0,
        emb: parseFloat(document.getElementById('cfEmb').value) || 0,
        mkt: parseFloat(document.getElementById('cfMkt').value) || 0,
        contador: parseFloat(document.getElementById('cfContador').value) || 0,
        outros: parseFloat(document.getElementById('cfOutros').value) || 0,
        pizzas: parseFloat(document.getElementById('cfPizzas').value) || 1
    };

    const total = Object.values(vals).reduce((a, b) => a + b, 0) - vals.pizzas;
    Object.assign(DB.custos, vals);

    document.getElementById('cfTotal').textContent = brl(total);
    document.getElementById('cfPorPizza').textContent = brl(calcularCustoFixoPorPizza());

    renderFichas();
    renderDashboard();
}

function salvarCustos() {
    DB.custos = {
        aluguel: parseFloat(document.getElementById('cfAluguel').value) || 0,
        energia: parseFloat(document.getElementById('cfEnergia').value) || 0,
        gas: parseFloat(document.getElementById('cfGas').value) || 0,
        agua: parseFloat(document.getElementById('cfAgua').value) || 0,
        internet: parseFloat(document.getElementById('cfInternet').value) || 0,
        func: parseFloat(document.getElementById('cfFunc').value) || 0,
        gasolina: parseFloat(document.getElementById('cfGasolina').value) || 0,
        emb: parseFloat(document.getElementById('cfEmb').value) || 0,
        mkt: parseFloat(document.getElementById('cfMkt').value) || 0,
        contador: parseFloat(document.getElementById('cfContador').value) || 0,
        outros: parseFloat(document.getElementById('cfOutros').value) || 0,
        pizzas: parseFloat(document.getElementById('cfPizzas').value) || 300
    };

    persistirDados(true, '✅ Custos salvos!');
    sincronizarUI();
}

function calcularCustoFixoPorPizza() {
    const c = DB.custos;
    const total =
        (c.aluguel || 0) +
        (c.energia || 0) +
        (c.gas || 0) +
        (c.agua || 0) +
        (c.internet || 0) +
        (c.func || 0) +
        (c.gasolina || 0) +
        (c.emb || 0) +
        (c.mkt || 0) +
        (c.contador || 0) +
        (c.outros || 0);

    let quantidadePizzasMensal = c.pizzas || 1;
    if (quantidadePizzasMensal <= 0) {
        quantidadePizzasMensal = 1;
        if (total > 0 && typeof window.metaAlertShown === 'undefined') {
            window.metaAlertShown = true;
            status('⚠️ Atenção: Configure a quantidade de pizzas mensais na aba Custos Fixos!', true);
        }
    }

    return total / quantidadePizzasMensal;
}

// ===== TAXAS SOBRE A VENDA E META DE LUCRO =====
// Taxa média (fração) descontada de cada venda:
// imposto em todas + comissão do app na parte vendida pelo app + maquininha no restante.
function taxaMediaVenda(t = DB.taxas) {
    if (!t) return 0;
    const parteApp = Math.min(Math.max(numero(t.vendasApp), 0), 100) / 100;
    return (numero(t.imposto) + numero(t.app) * parteApp + numero(t.cartao) * (1 - parteApp)) / 100;
}

function metaLucroFracao() {
    return numero(DB.taxas && DB.taxas.metaLucro, 15) / 100;
}

// Preço que cobre todos os custos, as taxas e ainda deixa a meta de lucro real.
function calcPrecoIdeal(custoTotal) {
    const divisor = 1 - taxaMediaVenda() - metaLucroFracao();
    return divisor > 0.05 ? custoTotal / divisor : null;
}

function loadTaxasUI() {
    const t = DB.taxas || {};
    const campos = { txImposto: t.imposto, txCartao: t.cartao, txApp: t.app, txVendasApp: t.vendasApp, txMeta: t.metaLucro };
    Object.entries(campos).forEach(([id, v]) => {
        const el = document.getElementById(id);
        if (el) el.value = v || (id === 'txMeta' ? 15 : '');
    });
    calcTaxasPreview();
}

function lerTaxasUI() {
    const v = (id) => parseFloat(document.getElementById(id)?.value) || 0;
    return { imposto: v('txImposto'), cartao: v('txCartao'), app: v('txApp'), vendasApp: Math.min(v('txVendasApp'), 100), metaLucro: v('txMeta') };
}

function calcTaxasPreview() {
    const el = document.getElementById('txMedia');
    if (!el) return;
    const t = lerTaxasUI();
    const media = taxaMediaVenda(t) * 100;
    el.textContent = pct(media);
    const aviso = document.getElementById('txAviso');
    if (aviso) {
        const sobra = 100 - media - t.metaLucro;
        aviso.textContent = sobra <= 5
            ? '⚠️ Taxas + meta passam de 95% do preço. Revise os valores.'
            : 'De cada R$ 100 vendidos, ' + brl(media) + ' vão para taxas e impostos.';
    }
}

function salvarTaxas() {
    DB.taxas = lerTaxasUI();
    persistirDados(true, '✅ Taxas e meta salvas!');
    sincronizarUI();
}

// ===== MASSA =====
function loadMassaUI() {
    const m = DB.massa;
    document.getElementById('massaPesoTotal').value = m.pesoTotal || 3000;
    document.getElementById('pesoP').value = m.pesoP || 200;
    document.getElementById('pesoM').value = m.pesoM || 300;
    document.getElementById('pesoG').value = m.pesoG || 400;
    document.getElementById('pesoGG').value = m.pesoGG || 500;
    document.getElementById('massaIngLista').innerHTML = '';

    if (m.ingredientes && m.ingredientes.length > 0) {
        m.ingredientes.forEach((ing) => addIngMassa(ing.insumoId, ing.quantidade));
    } else {
        addIngMassa();
    }

    setTimeout(calcMassa, 100);
}

function refreshMassaSelects() {
    document.querySelectorAll('#massaIngLista select').forEach((sel) => {
        const val = sel.value;
        sel.innerHTML = '<option value="">Selecione...</option>' + DB.insumos.map((i) => `<option value="${i.id}">${esc(i.nome)}</option>`).join('');
        sel.value = val;
        atualizarUnidadeLinha(sel);
    });
}

function addIngMassa(insId = null, qtd = null) {
    const lista = document.getElementById('massaIngLista');
    const div = document.createElement('div');
    div.className = 'massa-item';
    const insM = DB.insumos.find((i) => i.id == insId);
    div.innerHTML = `<select class="form-control" onchange="atualizarUnidadeLinha(this);calcMassa()"><option value="">Selecione...</option>${DB.insumos
        .map((i) => `<option value="${i.id}" ${insId == i.id ? 'selected' : ''}>${esc(i.nome)}</option>`)
        .join('')}</select><div class="qtd-wrap"><input type="number" class="form-control" placeholder="Qtd" inputmode="decimal" value="${qtd || ''}" oninput="calcMassa()"><span class="qtd-un">${insM ? unidadeBase(insM.unidade) : ''}</span></div><span class="custo">R$ 0</span><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcMassa()">✕</button>`;
    lista.appendChild(div);
    if (qtd) setTimeout(calcMassa, 50);
}

function calcMassa() {
    let custoTotal = 0;
    document.querySelectorAll('#massaIngLista .massa-item').forEach((item) => {
        const sel = item.querySelector('select');
        const inp = item.querySelector('input');
        const span = item.querySelector('.custo');
        const id = sel.value;
        const qtd = parseFloat(inp.value) || 0;

        if (id && qtd > 0) {
            const ins = DB.insumos.find((i) => i.id == id);
            if (ins) {
                const custo = (ins.custoUn || 0) * qtd;
                custoTotal += custo;
                span.textContent = brl(custo);
            }
        } else {
            span.textContent = 'R$ 0';
        }
    });

    const pesoTotal = parseFloat(document.getElementById('massaPesoTotal').value) || 1;
    const cpg = custoTotal / Math.max(pesoTotal, 1);
    const pesoP = parseFloat(document.getElementById('pesoP').value) || 0;
    const pesoM = parseFloat(document.getElementById('pesoM').value) || 0;
    const pesoG = parseFloat(document.getElementById('pesoG').value) || 0;
    const pesoGG = parseFloat(document.getElementById('pesoGG').value) || 0;

    document.getElementById('massaCustoTotal').textContent = brl(custoTotal);
    document.getElementById('massaPesoTotalRes').textContent = pesoTotal + ' g';
    document.getElementById('massaCustoGrama').textContent = 'R$ ' + cpg.toFixed(4).replace('.', ',');
    document.getElementById('massaCustoP').textContent = brl((cpg * pesoP));
    document.getElementById('massaCustoM').textContent = brl((cpg * pesoM));
    document.getElementById('massaCustoG').textContent = brl((cpg * pesoG));
    document.getElementById('massaCustoGG').textContent = brl((cpg * pesoGG));
    document.getElementById('massaInfoP').textContent = pesoP + 'g × R$ ' + cpg.toFixed(4).replace('.', ',');
    document.getElementById('massaInfoM').textContent = pesoM + 'g × R$ ' + cpg.toFixed(4).replace('.', ',');
    document.getElementById('massaInfoG').textContent = pesoG + 'g × R$ ' + cpg.toFixed(4).replace('.', ',');
    document.getElementById('massaInfoGG').textContent = pesoGG + 'g × R$ ' + cpg.toFixed(4).replace('.', ',');
}

function salvarMassa() {
    const ingredientes = [];
    document.querySelectorAll('#massaIngLista .massa-item').forEach((item) => {
        const id = item.querySelector('select').value;
        const qtd = parseFloat(item.querySelector('input').value) || 0;
        if (id && qtd > 0) ingredientes.push({ insumoId: id, quantidade: qtd });
    });

    DB.massa = {
        ingredientes,
        pesoTotal: parseFloat(document.getElementById('massaPesoTotal').value) || 3000,
        pesoP: parseFloat(document.getElementById('pesoP').value) || 200,
        pesoM: parseFloat(document.getElementById('pesoM').value) || 300,
        pesoG: parseFloat(document.getElementById('pesoG').value) || 400,
        pesoGG: parseFloat(document.getElementById('pesoGG').value) || 500
    };

    persistirDados(true, '✅ Massa salva!');
    renderFichas();
    renderDashboard();
}

function getCustoMassa(tamanho) {
    const m = DB.massa;
    if (!m.ingredientes || m.ingredientes.length === 0) return 0;

    let custoTotal = 0;
    m.ingredientes.forEach((ing) => {
        const ins = DB.insumos.find((i) => i.id == ing.insumoId);
        if (ins) custoTotal += (ins.custoUn || 0) * ing.quantidade;
    });

    const cpg = custoTotal / (m.pesoTotal || 3000);
    const pesos = { P: m.pesoP || 200, M: m.pesoM || 300, G: m.pesoG || 400, GG: m.pesoGG || 500 };
    return cpg * (pesos[tamanho] || 0);
}

// ===== FICHAS: UM SABOR, TODOS OS TAMANHOS =====
// Na tela, o sabor é cadastrado uma vez com a quantidade e o preço de cada tamanho.
// Nos dados, continua existindo uma ficha por tamanho (ligadas pelo mesmo grupoId),
// então Gerar Preço, meio a meio, combos, painel e avisos funcionam do mesmo jeito.
const TAMANHOS = ['P', 'M', 'G', 'GG'];
const NOMES_TAMANHO = { P: 'Pequena', M: 'Média', G: 'Grande', GG: 'Gigante' };
let editandoGrupo = null; // { grupoId, ids: { P: fichaId, ... } }

function normalizarNome(n) {
    return String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function tamanhosAtivos() {
    return TAMANHOS.filter((t) => document.querySelector('#ficTamanhos input[value="' + t + '"]')?.checked);
}

function tamanhosPadrao() {
    try {
        const salvos = JSON.parse(localStorage.getItem('pcTamanhosPadrao') || 'null');
        if (Array.isArray(salvos) && salvos.length) return salvos.filter((t) => TAMANHOS.includes(t));
    } catch (e) {}
    const usados = TAMANHOS.filter((t) => DB.fichas.some((f) => f.tamanho === t));
    return usados.length ? usados : ['G'];
}

function lembrarTamanhos(ativos) {
    try { localStorage.setItem('pcTamanhosPadrao', JSON.stringify(ativos)); } catch (e) {}
}

function opcoesInsumos(selId) {
    return '<option value="">Selecione o ingrediente...</option>' + DB.insumos
        .map((i) => `<option value="${i.id}" ${selId == i.id ? 'selected' : ''}>${esc(i.nome)} (${brl(custoNaUnidadeCompra(i))}/${esc(i.unidade)})</option>`)
        .join('');
}

function refreshIngSelects() {
    document.querySelectorAll('#ficIngLista select').forEach((sel) => {
        const val = sel.value;
        sel.innerHTML = opcoesInsumos(val);
        sel.value = val;
        atualizarUnidadeLinha(sel);
    });
}

function addIngFicha(insId = null, qtds = {}) {
    const lista = document.getElementById('ficIngLista');
    if (!lista) return;
    const ins = DB.insumos.find((i) => i.id == insId);
    const un = ins ? unidadeBase(ins.unidade) : '';
    const div = document.createElement('div');
    div.className = 'ingrediente-item ing-tam';
    div.innerHTML = `<div class="ing-topo"><select class="form-control" onchange="atualizarUnidadeLinha(this);calcFicha()">${opcoesInsumos(insId)}</select><button type="button" class="btn btn-danger btn-sm" title="Remover ingrediente" aria-label="Remover ingrediente" onclick="this.closest('.ingrediente-item').remove();calcFicha()">✕</button></div>
        <div class="qtd-tams">${TAMANHOS.map((t) => `<label class="qtd-tam" data-tam="${t}"><span class="qtd-tam-nome">${t}</span><div class="qtd-wrap"><input type="number" class="form-control" min="0" step="any" inputmode="decimal" data-tam="${t}" value="${qtds[t] || ''}" placeholder="0" oninput="calcFicha()" aria-label="Quantidade na ${NOMES_TAMANHO[t]}"><span class="qtd-un">${un}</span></div><small class="custo-tam" data-tam="${t}"></small></label>`).join('')}</div>`;
    lista.appendChild(div);
    aplicarVisibilidadeTamanhos();
}

function aplicarVisibilidadeTamanhos() {
    const ativos = tamanhosAtivos();
    document.querySelectorAll('#page-nova-ficha .qtd-tam, #page-nova-ficha .preco-tam').forEach((el) => {
        el.style.display = ativos.includes(el.dataset.tam) ? '' : 'none';
    });
    document.querySelectorAll('#ficTamanhos .tam-chip').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked));
    const btn = document.getElementById('btnProporcional');
    if (btn) btn.style.display = ativos.length > 1 ? '' : 'none';
}

function lerFichaForm() {
    const ativos = tamanhosAtivos();
    const incMassa = document.getElementById('ficMassa').value === '1';
    const linhas = [];
    document.querySelectorAll('#ficIngLista .ingrediente-item').forEach((item) => {
        const id = item.querySelector('select').value;
        const qtd = {};
        item.querySelectorAll('input[data-tam]').forEach((inp) => { qtd[inp.dataset.tam] = parseFloat(inp.value) || 0; });
        linhas.push({ item, id, ins: DB.insumos.find((i) => i.id == id), qtd });
    });
    const precos = {};
    TAMANHOS.forEach((t) => { precos[t] = parseFloat(document.getElementById('ficPreco_' + t)?.value) || 0; });
    return { ativos, incMassa, linhas, precos };
}

function calcFicha() {
    const box = document.getElementById('ficResumoTabela');
    if (!box) return;
    const { ativos, incMassa, linhas, precos } = lerFichaForm();
    const custoFixo = calcularCustoFixoPorPizza();
    const taxa = taxaMediaVenda();
    const custoIng = {};
    TAMANHOS.forEach((t) => { custoIng[t] = 0; });

    linhas.forEach((l) => {
        TAMANHOS.forEach((t) => {
            const c = l.ins && l.qtd[t] > 0 ? (l.ins.custoUn || 0) * l.qtd[t] : 0;
            custoIng[t] += c;
            const el = l.item.querySelector('.custo-tam[data-tam="' + t + '"]');
            if (el) el.textContent = c > 0 ? brl(c) : '';
        });
    });

    if (!ativos.length) {
        box.innerHTML = '<div class="empty">Marque pelo menos um tamanho acima.</div>';
        return;
    }

    box.innerHTML = ativos.map((t) => {
        const massa = incMassa ? getCustoMassa(t) : 0;
        const total = custoIng[t] + massa + custoFixo;
        const venda = precos[t];
        const taxas = venda * taxa;
        const lucro = venda - total - taxas;
        const cmv = venda > 0 ? ((custoIng[t] + massa) / venda) * 100 : 0;
        const margem = venda > 0 ? (lucro / venda) * 100 : 0;
        const ideal = calcPrecoIdeal(total);
        const linha = (rotulo, valor, cls = '') => `<div class="res-linha ${cls}"><span>${rotulo}</span><b>${valor}</b></div>`;
        return `<div class="res-tam">
            <div class="res-tam-cab"><span class="badge-size ${t}">${t}</span> ${NOMES_TAMANHO[t]}</div>
            ${linha('Ingredientes', brl(custoIng[t]))}
            ${linha('Massa', brl(massa))}
            ${isPro ? linha('Custo fixo', brl(custoFixo)) : ''}
            ${isPro && taxa > 0 ? linha('Taxas (' + pct(taxa * 100) + ')', brl(taxas)) : ''}
            ${linha('Custo total', brl(total), 'res-total')}
            ${linha('Preço de venda', venda > 0 ? brl(venda) : '<span style="color:#c62828">falta</span>')}
            <div class="res-lucro ${venda > 0 ? (lucro >= 0 ? 'pos' : 'neg') : ''}"><small>${isPro ? 'Lucro real' : 'Lucro (sem custo fixo)'}</small><strong>${venda > 0 ? brl(lucro) : '-'}</strong><small>${venda > 0 ? 'Margem ' + pct(margem) + ' · CMV ' + pct(cmv) : ''}</small></div>
            ${isPro && ideal && custoIng[t] > 0 ? `<div class="res-meta">🎯 Preço para a meta: <b>${brl(ideal)}</b></div>` : ''}
        </div>`;
    }).join('');
}

function preencherProporcional() {
    const { ativos, linhas } = lerFichaForm();
    if (ativos.length < 2) { alert('Marque pelo menos dois tamanhos.'); return; }
    const m = DB.massa || {};
    const peso = { P: m.pesoP || 200, M: m.pesoM || 300, G: m.pesoG || 400, GG: m.pesoGG || 500 };
    const preenchidos = (t) => linhas.filter((l) => l.ins && l.qtd[t] > 0).length;
    const base = [...ativos].sort((a, b) => preenchidos(b) - preenchidos(a) || (b === 'G') - (a === 'G'))[0];
    if (!preenchidos(base)) { alert('Preencha as quantidades de pelo menos um tamanho primeiro.'); return; }

    let n = 0;
    linhas.forEach((l) => {
        if (!l.ins || !(l.qtd[base] > 0)) return;
        const casas = unidadeBase(l.ins.unidade) === 'un' ? 100 : 1;
        ativos.forEach((t) => {
            if (t === base) return;
            const inp = l.item.querySelector('input[data-tam="' + t + '"]');
            if (inp && !(parseFloat(inp.value) > 0)) {
                inp.value = String(Math.round((l.qtd[base] * peso[t] / peso[base]) * casas) / casas);
                n++;
            }
        });
    });
    calcFicha();
    status(n ? '⚖️ ' + n + ' quantidades preenchidas a partir da ' + NOMES_TAMANHO[base] + '. Confira e ajuste se precisar.' : 'Os outros tamanhos já estavam preenchidos.');
}

function limparFichaPosSalvar() {
    limparFicha();
    filtroTam = 'all';
    document.querySelectorAll('.size-tab').forEach((t) => t.classList.remove('active'));
    const allTab = document.querySelector('.size-tab.all');
    if (allTab) allTab.classList.add('active');
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.querySelector('[data-page="fichas"]').classList.add('active');
    document.getElementById('page-fichas').classList.add('active');
}

function salvarFicha() {
    const nome = document.getElementById('ficNome').value.trim();
    const cat = document.getElementById('ficCat').value;
    const { ativos, incMassa, linhas, precos } = lerFichaForm();

    if (!nome) { alert('⚠️ Preencha o nome da pizza!'); return; }
    if (!ativos.length) { alert('⚠️ Marque pelo menos um tamanho!'); return; }
    const problemas = [];
    ativos.forEach((t) => {
        if (!(precos[t] > 0)) problemas.push(NOMES_TAMANHO[t] + ': falta o preço de venda');
        if (!linhas.some((l) => l.ins && l.qtd[t] > 0)) problemas.push(NOMES_TAMANHO[t] + ': falta a quantidade dos ingredientes');
    });
    if (problemas.length) { alert('⚠️ Complete antes de salvar:\n\n• ' + problemas.join('\n• ')); return; }

    const editando = !!editandoGrupo;
    const grupoId = editando ? editandoGrupo.grupoId : gerarId();
    const idsAnteriores = editando ? editandoGrupo.ids : {};
    const removidos = Object.keys(idsAnteriores).filter((t) => !ativos.includes(t));
    if (removidos.length && !confirm('Você desmarcou: ' + removidos.map((t) => NOMES_TAMANHO[t]).join(', ') + '.\nA ficha desse tamanho será excluída. Continuar?')) return;
    DB.fichas = DB.fichas.filter((f) => !removidos.some((t) => idsAnteriores[t] === f.id));

    ativos.forEach((t) => {
        const ingredientes = linhas
            .filter((l) => l.ins && l.qtd[t] > 0)
            .map((l) => ({ insumoId: l.ins.id, nome: l.ins.nome, quantidade: l.qtd[t], unidade: unidadeBase(l.ins.unidade), custo: (l.ins.custoUn || 0) * l.qtd[t] }));
        const ficha = { id: idsAnteriores[t] || gerarId(), grupoId, nome, categoria: cat, tamanho: t, precoVenda: precos[t], incMassa, ingredientes };
        atualizarCustosDaFicha(ficha);
        const idx = DB.fichas.findIndex((f) => f.id === ficha.id);
        if (idx !== -1) DB.fichas[idx] = ficha;
        else DB.fichas.push(ficha);
    });

    lembrarTamanhos(ativos);
    persistirDados(false);
    status((editando ? '💾 Ficha atualizada' : '💾 Ficha salva') + (ativos.length > 1 ? ' (' + ativos.length + ' tamanhos)!' : '!'));
    limparFichaPosSalvar();
    sincronizarUI();
}

function limparFicha() {
    editandoGrupo = null;
    document.getElementById('ficNome').value = '';
    document.getElementById('ficCat').value = 'Tradicional';
    document.getElementById('ficMassa').value = '1';
    document.getElementById('fichaHeader').textContent = '➕ Nova Ficha Técnica';
    document.getElementById('fichaHeader').style.background = '';
    const padrao = tamanhosPadrao();
    document.querySelectorAll('#ficTamanhos input').forEach((c) => { c.checked = padrao.includes(c.value); });
    TAMANHOS.forEach((t) => { const p = document.getElementById('ficPreco_' + t); if (p) p.value = ''; });
    document.getElementById('ficIngLista').innerHTML = '';
    addIngFicha();
    aplicarVisibilidadeTamanhos();
    calcFicha();
}

// Junta as fichas do mesmo sabor. Fichas antigas (sem grupo) são juntadas pelo nome igual.
function grupoDaFicha(f) {
    const grupo = f.grupoId
        ? DB.fichas.filter((x) => x.grupoId === f.grupoId)
        : DB.fichas.filter((x) => !x.grupoId && normalizarNome(x.nome) === normalizarNome(f.nome));
    const porTam = {};
    porTam[f.tamanho] = f;
    grupo.forEach((x) => { if (!porTam[x.tamanho]) porTam[x.tamanho] = x; });
    return porTam;
}

function editarFicha(id) {
    const f = DB.fichas.find((x) => x.id === id);
    if (!f) return;
    const porTam = grupoDaFicha(f);
    const tams = TAMANHOS.filter((t) => porTam[t]);

    editandoGrupo = { grupoId: f.grupoId || gerarId(), ids: {} };
    tams.forEach((t) => { editandoGrupo.ids[t] = porTam[t].id; });

    document.getElementById('ficNome').value = f.nome;
    document.getElementById('ficCat').value = f.categoria;
    document.getElementById('ficMassa').value = f.incMassa !== false ? '1' : '0';
    document.querySelectorAll('#ficTamanhos input').forEach((c) => { c.checked = tams.includes(c.value); });
    TAMANHOS.forEach((t) => { const p = document.getElementById('ficPreco_' + t); if (p) p.value = porTam[t] ? porTam[t].precoVenda : ''; });

    const ordem = [];
    const qtds = {};
    tams.forEach((t) => {
        (porTam[t].ingredientes || []).forEach((ing) => {
            if (!qtds[ing.insumoId]) { qtds[ing.insumoId] = {}; ordem.push(ing.insumoId); }
            qtds[ing.insumoId][t] = ing.quantidade;
        });
    });
    document.getElementById('ficIngLista').innerHTML = '';
    ordem.forEach((insId) => addIngFicha(insId, qtds[insId]));
    if (!ordem.length) addIngFicha();
    aplicarVisibilidadeTamanhos();
    calcFicha();

    document.getElementById('fichaHeader').textContent = '✏️ Editando: ' + f.nome + (tams.length > 1 ? ' (' + tams.join(', ') + ')' : '');
    document.getElementById('fichaHeader').style.background = 'linear-gradient(135deg, #ff9800, #e65100)';
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.querySelector('[data-page="nova-ficha"]').classList.add('active');
    document.getElementById('page-nova-ficha').classList.add('active');
    refreshIngSelects();
    window.scrollTo(0, 0);
}

function excluirFicha(id) {
    const f = DB.fichas.find((x) => x.id === id);
    if (!f) return;
    const outros = Object.keys(grupoDaFicha(f)).length - 1;
    if (!confirm('Excluir a ficha "' + f.nome + '" (' + NOMES_TAMANHO[f.tamanho] + ')?' + (outros > 0 ? '\n\nOs outros tamanhos deste sabor continuam.' : ''))) return;

    DB.fichas = DB.fichas.filter((x) => x.id !== id);
    persistirDados(false);
    sincronizarUI();
    status('🗑️ Excluída!');
}

function duplicarFicha(id) {
    const f = DB.fichas.find((x) => x.id === id);
    if (!f) return;
    const porTam = grupoDaFicha(f);
    const novoGrupo = gerarId();
    Object.values(porTam).forEach((x) => {
        const copia = clonar(x);
        copia.id = gerarId();
        copia.grupoId = novoGrupo;
        copia.nome = x.nome + ' (Cópia)';
        DB.fichas.push(copia);
    });

    persistirDados(false);
    sincronizarUI();
    const n = Object.keys(porTam).length;
    status('📋 Duplicada' + (n > 1 ? ' com ' + n + ' tamanhos' : '') + '!');
}

function atualizarCustosDaFicha(f) {
    if (f.ingredientes) {
        let custoIng = 0;
        f.ingredientes.forEach((ing) => {
            const ins = DB.insumos.find((i) => i.id == ing.insumoId);
            if (ins && typeof ins.custoUn !== 'undefined') {
                ing.custo = ins.custoUn * ing.quantidade;
                custoIng += ing.custo;
            } else {
                custoIng += ing.custo || 0;
            }
        });
        f.custoIng = custoIng;
    }

    f.custoMassa = f.incMassa !== false ? getCustoMassa(f.tamanho) : 0;
    f.custoFixo = calcularCustoFixoPorPizza();
    f.custoTotal = (f.custoIng || 0) + f.custoMassa + f.custoFixo;
    f.taxas = f.precoVenda * taxaMediaVenda();
    f.lucro = f.precoVenda - f.custoTotal - f.taxas;
    f.margemReal = f.precoVenda > 0 ? (f.lucro / f.precoVenda) * 100 : 0;
    f.precoIdeal = calcPrecoIdeal(f.custoTotal);
    f.cmv = f.precoVenda > 0 ? (((f.custoIng || 0) + f.custoMassa) / f.precoVenda) * 100 : 0;
}

function renderFichas() {
    DB.fichas.forEach((f) => atualizarCustosDaFicha(f));
    const cnt = { P: 0, M: 0, G: 0, GG: 0 };
    DB.fichas.forEach((f) => {
        if (cnt[f.tamanho] !== undefined) cnt[f.tamanho]++;
    });

    const cntAll = document.getElementById('cntAll');
    const cntTabP = document.getElementById('cntTabP');
    const cntTabM = document.getElementById('cntTabM');
    const cntTabG = document.getElementById('cntTabG');
    const cntTabGG = document.getElementById('cntTabGG');
    if (cntAll) cntAll.textContent = DB.fichas.length;
    if (cntTabP) cntTabP.textContent = cnt.P;
    if (cntTabM) cntTabM.textContent = cnt.M;
    if (cntTabG) cntTabG.textContent = cnt.G;
    if (cntTabGG) cntTabGG.textContent = cnt.GG;

    const fichas = filtroTam === 'all' ? DB.fichas : DB.fichas.filter((f) => f.tamanho === filtroTam);
    const grid = document.getElementById('fichasGrid');
    if (!grid) return;

    if (fichas.length === 0) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="icon">📋</div>Nenhuma ficha</div>';
        return;
    }

    grid.innerHTML = fichas
        .map(
            (f) =>
                `<div class="ficha-card ${f.tamanho}"><div class="ficha-header"><div><h3>${esc(f.nome)}</h3><small>${esc(f.categoria)}</small></div><span class="badge-size ${f.tamanho}">${f.tamanho}</span></div><div class="ficha-body"><div class="ficha-stats"><div class="ficha-stat"><small>Custo</small><div class="val red">${brl(f.custoTotal)}</div></div><div class="ficha-stat"><small>Venda</small><div class="val blue">${brl(f.precoVenda)}</div></div><div class="ficha-stat"><small>Lucro real</small><div class="val ${f.lucro >= 0 ? 'green' : 'red'}">${brl(f.lucro)}</div></div></div><div class="ficha-details">Ing: ${brl((f.custoIng || 0))} | Massa: ${brl(f.custoMassa)} | Fixo: ${brl(f.custoFixo)}${f.taxas > 0 ? ' | Taxas: ' + brl(f.taxas) : ''} | CMV: ${pct(f.cmv)}</div><div class="ficha-actions"><button class="btn btn-warning btn-sm" onclick="editarFicha('${f.id}')">✏️</button><button class="btn btn-purple btn-sm" onclick="duplicarFicha('${f.id}')">📋</button><button class="btn btn-danger btn-sm" onclick="excluirFicha('${f.id}')">🗑️</button></div></div></div>`
        )
        .join('');
}

function filtrarTamanho(tam, btn) {
    filtroTam = tam;
    document.querySelectorAll('.size-tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    renderFichas();
}

function filtrarFichas() {
    const busca = document.getElementById('buscaFic').value.toLowerCase();
    document.querySelectorAll('.ficha-card').forEach((c) => {
        c.style.display = c.textContent.toLowerCase().includes(busca) ? '' : 'none';
    });
}

// ===== DASHBOARD =====
function renderDashboard() {
    DB.fichas.forEach((f) => atualizarCustosDaFicha(f));
    const cnt = { P: 0, M: 0, G: 0, GG: 0 };
    DB.fichas.forEach((f) => {
        if (cnt[f.tamanho] !== undefined) cnt[f.tamanho]++;
    });

    const cntP = document.getElementById('cntP');
    const cntM = document.getElementById('cntM');
    const cntG = document.getElementById('cntG');
    const cntGG = document.getElementById('cntGG');
    const dashIns = document.getElementById('dashIns');
    const dashFic = document.getElementById('dashFic');
    const dashCF = document.getElementById('dashCF');
    const dashMassaM = document.getElementById('dashMassaM');
    const dashMassaG = document.getElementById('dashMassaG');

    if (cntP) cntP.textContent = cnt.P;
    if (cntM) cntM.textContent = cnt.M;
    if (cntG) cntG.textContent = cnt.G;
    if (cntGG) cntGG.textContent = cnt.GG;
    if (dashIns) dashIns.textContent = DB.insumos.length;
    if (dashFic) dashFic.textContent = DB.fichas.length;
    if (dashCF) dashCF.textContent = brl(calcularCustoFixoPorPizza());
    if (dashMassaM) dashMassaM.textContent = brl(getCustoMassa('M'));
    if (dashMassaG) dashMassaG.textContent = brl(getCustoMassa('G'));

    const lucroMedio = DB.fichas.length ? DB.fichas.reduce((acc, f) => acc + (f.lucro || 0), 0) / DB.fichas.length : 0;
    const dashFatElem = document.getElementById('dashFat');
    if (dashFatElem) dashFatElem.textContent = brl(lucroMedio);

    let maiorMargemTxt = '-';
    if (DB.fichas.length > 0) {
        const topMargem = [...DB.fichas].sort((a, b) => {
            const margemA = a.precoVenda > 0 ? (a.lucro / a.precoVenda) * 100 : 0;
            const margemB = b.precoVenda > 0 ? (b.lucro / b.precoVenda) * 100 : 0;
            return margemB - margemA;
        });
        if (topMargem[0] && topMargem[0].precoVenda > 0) {
            maiorMargemTxt = topMargem[0].nome + ' (' + pct(((topMargem[0].lucro / topMargem[0].precoVenda) * 100)) + ')';
        }
    }
    const dashMargemElem = document.getElementById('dashMaiorMargem');
    if (dashMargemElem) dashMargemElem.textContent = maiorMargemTxt;

    const topLista = document.getElementById('topLista');
    if (!topLista) return;

    if (DB.fichas.length > 0) {
        const top = [...DB.fichas].sort((a, b) => b.lucro - a.lucro).slice(0, 5);

        const htmlTable = `<table class="top5-desktop"><thead><tr><th>🍕 Pizza</th><th>$$ Venda</th><th>📈 Lucro</th></tr></thead><tbody>${top
            .map(
                (f) =>
                    `<tr><td><strong>${esc(f.nome)}</strong><br><small style="color:#777">Custo: ${brl(f.custoTotal)}</small></td><td>${brl(f.precoVenda)}</td><td style="color:var(--success);font-weight:bold">${brl(f.lucro)}</td></tr>`
            )
            .join('')}</tbody></table>`;
        const htmlCards = `<div class="top5-mobile"><div class="top5-list">${top
            .map(
                (f) =>
                    `<div class="top5-mobile-card"><div class="t-title">${esc(f.nome)}</div><div class="t-row"><span>Custo: ${brl(f.custoTotal)}</span></div><div class="t-row"><span>$$ Venda: ${brl(f.precoVenda)}</span></div><div class="t-profit">💰 Lucro: ${brl(f.lucro)}</div></div>`
            )
            .join('')}</div></div>`;

        topLista.innerHTML = htmlTable + htmlCards;
    } else {
        topLista.innerHTML = '<div class="empty">Cadastre fichas</div>';
    }

    renderAbaixoDaMeta();
    renderRankingProdutosProntos();
}

function renderAbaixoDaMeta() {
    const box = document.getElementById('metaLista');
    const cont = document.getElementById('metaContador');
    if (!box) return;

    if (!isPro) {
        if (cont) cont.textContent = '🔒 PRO';
        box.innerHTML = '<div class="aviso-upgrade-pro" id="metaTeaser">🔒 No PRO você vê quais pizzas estão abaixo da sua meta de lucro e o preço certo de cada uma, já com custo fixo, massa e taxas.</div>';
        document.getElementById('metaTeaser').addEventListener('click', () => mostrarModalUpgrade('precificar'));
        return;
    }

    const meta = metaLucroFracao() * 100;
    if (DB.fichas.length === 0) {
        if (cont) cont.textContent = '';
        box.innerHTML = '<div class="empty">Cadastre fichas para ver quais pizzas estão abaixo da meta.</div>';
        return;
    }

    const semCustos = calcularCustoFixoPorPizza() === 0;
    const semTaxas = taxaMediaVenda() === 0;
    const dica = semCustos || semTaxas
        ? '<div class="alert alert-info" style="margin-bottom:12px">💡 Para o lucro ser real, preencha ' + (semCustos ? 'os <strong>Custos Fixos</strong>' : '') + (semCustos && semTaxas ? ' e ' : '') + (semTaxas ? 'as <strong>taxas</strong> (imposto, maquininha, app)' : '') + ' na aba Custos Fixos.</div>'
        : '';

    const abaixo = DB.fichas.filter((f) => f.margemReal < meta - 0.05).sort((a, b) => a.margemReal - b.margemReal);
    if (cont) cont.textContent = abaixo.length ? abaixo.length + ' abaixo' : '✅';

    if (abaixo.length === 0) {
        box.innerHTML = dica + '<div class="alert alert-success" style="margin:0">✅ Todas as ' + DB.fichas.length + ' pizzas estão na sua meta de ' + pct(meta, 0) + ' de lucro real.</div>';
        return;
    }

    const linhas = abaixo.map((f) => {
        const ideal = f.precoIdeal;
        const dif = ideal ? ideal - f.precoVenda : 0;
        return `<div class="meta-item">
            <div class="meta-nome"><strong>${esc(f.nome)}</strong> <span class="badge-size ${f.tamanho}">${f.tamanho}</span><br>
                <small>Cobra ${brl(f.precoVenda)} · lucro real <b style="color:${f.lucro >= 0 ? '#e65100' : 'var(--danger)'}">${brl(f.lucro)} (${pct(f.margemReal)})</b></small></div>
            <div class="meta-ideal"><small>Preço para a meta</small><strong>${ideal ? brl(ideal) : '-'}</strong>${ideal ? `<small class="meta-dif">+${brl(dif)}</small>` : ''}</div>
        </div>`;
    }).join('');

    box.innerHTML = dica + '<p style="margin:0 0 12px;color:#555">Sua meta: <strong>' + pct(meta, 0) + ' de lucro real</strong> em cada pizza. Estas estão abaixo:</p>' + linhas;
}

function renderRankingProdutosProntos() {
    const container = document.getElementById('topProdutosLista');
    if (!container) return;

    if (DB.produtosProntos.length === 0) {
        container.innerHTML = '<div class="empty"><div class="icon">🥤</div>Cadastre produtos prontos para ver o ranking</div>';
        return;
    }

    const ranking = DB.produtosProntos.map(p => {
        const lucro = (p.precoVenda || 0) - (p.precoCusto || 0);
        const margem = p.precoVenda > 0 ? (lucro / p.precoVenda) * 100 : 0;
        const catIcons = { 'Bebida': '🥤', 'Cerveja': '🍺', 'Doce': '🍫', 'Adicional': '➕' };
        return { ...p, lucro, margem, icon: catIcons[p.categoria] || '📦' };
    }).sort((a, b) => b.lucro - a.lucro);

    const htmlTable = `<table class="top5-desktop"><thead><tr><th>🥤 Produto</th><th>Categoria</th><th>💰 Lucro</th><th>📊 Margem</th></tr></thead><tbody>${ranking
        .map(p =>
            `<tr><td><strong>${esc(p.nome)}</strong><br><small style="color:#777">Custo: ${brl(p.precoCusto)} | Venda: ${brl(p.precoVenda)}</small></td><td><span class="badge badge-info">${p.icon} ${p.categoria}</span></td><td style="color:${p.lucro >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:bold">${brl(p.lucro)}</td><td style="font-weight:bold">${pct(p.margem)}</td></tr>`
        ).join('')}</tbody></table>`;

    const htmlCards = `<div class="top5-mobile"><div class="top5-list">${ranking
        .map(p =>
            `<div class="top5-mobile-card" style="border-left-color:#00897b"><div class="t-title">${p.icon} ${esc(p.nome)}</div><div class="t-row"><span style="color:#777">${p.categoria}</span></div><div class="t-row"><span>Custo: ${brl(p.precoCusto)}</span><span>Venda: ${brl(p.precoVenda)}</span></div><div class="t-profit" style="color:${p.lucro >= 0 ? 'var(--success)' : 'var(--danger)'}">💰 Lucro: ${brl(p.lucro)} | Margem: ${pct(p.margem)}</div></div>`
        ).join('')}</div></div>`;

    container.innerHTML = htmlTable + htmlCards;
}

// ===== PRECIFICAR =====
function loadFichasSelect() {
    const select = document.getElementById('calcFicha');
    if (!select) return;

    const anterior = select.value;
    select.innerHTML = '<option value="">-- Selecione --</option>' + DB.fichas.map((f) => `<option value="${f.id}">${esc(f.nome)} (${f.tamanho})</option>`).join('');
    select.value = DB.fichas.some((f) => f.id === anterior) ? anterior : '';
    // Recalcula na hora com os preços atuais (ou esconde o resultado se a ficha não existe mais)
    calcComFicha();
}

function calcPorCMV() {
    const custo = parseFloat(document.getElementById('calcCusto').value) || 0;
    const cmv = parseFloat(document.getElementById('calcCMV').value) || 30;
    document.getElementById('calcCMVVal').textContent = cmv + '%';
    if (custo > 0) {
        const preco = custo / (cmv / 100);
        document.getElementById('calcPreco').textContent = brl(preco);
        document.getElementById('calcLucro').textContent = 'Lucro: ' + brl((preco - custo));
    }
}

function calcComFicha() {
    const id = document.getElementById('calcFicha').value;
    const res = document.getElementById('calcFichaRes');
    if (!id) {
        res.style.display = 'none';
        return;
    }

    const f = DB.fichas.find((x) => x.id == id);
    if (!f) return;

    atualizarCustosDaFicha(f);
    const custoMassa = f.custoMassa;
    const custoFixo = f.custoFixo;
    const custoTotal = f.custoTotal;
    res.style.display = 'block';
    document.getElementById('cfIng').textContent = brl((f.custoIng || 0));
    document.getElementById('cfMassaVal').textContent = brl(custoMassa);
    document.getElementById('cfFixo').textContent = brl(custoFixo);
    document.getElementById('cfTot').textContent = brl(custoTotal);
    // Preço pelo CMV: divide só o custo da mercadoria (ingredientes + massa).
    // Embaixo mostra o lucro real nesse preço, já descontando o custo fixo.
    const custoMercadoria = (f.custoIng || 0) + custoMassa;
    const taxa = taxaMediaVenda();
    const cfTaxasEl = document.getElementById('cfTaxasPct');
    if (cfTaxasEl) cfTaxasEl.textContent = pct(taxa * 100) + ' do preço';
    const metaBox = document.getElementById('cfMeta');
    if (metaBox) {
        const ideal = calcPrecoIdeal(custoTotal);
        if (ideal) {
            const dif = ideal - f.precoVenda;
            metaBox.innerHTML = '🎯 <strong>Preço para sua meta de ' + pct(metaLucroFracao() * 100, 0) + ' de lucro real: ' + brl(ideal) + '</strong><br><small>Hoje você cobra ' + brl(f.precoVenda) +
                (Math.abs(dif) < 0.5 ? ' e já está na meta. ✅' : dif > 0 ? ': faltam ' + brl(dif) + ' por pizza.' : ': ' + brl(-dif) + ' acima da meta. ✅') + '</small>';
            metaBox.className = 'alert ' + (dif > 0.5 ? 'alert-warning' : 'alert-success');
        } else {
            metaBox.innerHTML = '⚠️ Taxas + meta de lucro passam de 95% do preço. Revise em Custos Fixos.';
            metaBox.className = 'alert alert-warning';
        }
        metaBox.style.display = 'block';
    }
    [['cfP35', 0.35], ['cfP30', 0.3], ['cfP25', 0.25]].forEach(([elId, alvo]) => {
        const preco = custoMercadoria / alvo;
        const lucro = preco - custoTotal - preco * taxa;
        document.getElementById(elId).innerHTML = brl(preco) +
            '<small style="display:block;font-size:0.5em;font-weight:600;margin-top:4px;color:' + (lucro >= 0 ? 'inherit' : '#c62828') + '">Lucro real: ' + brl(lucro) + '</small>';
    });
}

// ===== MEIO A MEIO =====
function loadFichasSelectMeioAMeio() {
    const selA = document.getElementById('maMSaborA');
    const selB = document.getElementById('maMSaborB');
    if (!selA || !selB) return;

    const options = '<option value="">-- Selecione --</option>' +
        DB.fichas.map(f => `<option value="${f.id}">${esc(f.nome)} (${f.tamanho}) - ${brl(f.precoVenda)}</option>`).join('');
    
    const valA = selA.value;
    const valB = selB.value;
    selA.innerHTML = options;
    selB.innerHTML = options;
    selA.value = DB.fichas.some((f) => f.id === valA) ? valA : '';
    selB.value = DB.fichas.some((f) => f.id === valB) ? valB : '';
}

function calcMeioAMeio() {
    const idA = document.getElementById('maMSaborA').value;
    const idB = document.getElementById('maMSaborB').value;
    const resDiv = document.getElementById('maMResultado');

    if (!idA || !idB) {
        resDiv.style.display = 'none';
        return;
    }

    if (idA === idB) {
        resDiv.style.display = 'block';
        resDiv.innerHTML = '<div class="alert alert-warning" style="margin:0">⚠️ Selecione dois sabores <strong>diferentes</strong> para simular a Meio a Meio!</div>';
        return;
    }

    const fichaA = DB.fichas.find(f => f.id === idA);
    const fichaB = DB.fichas.find(f => f.id === idB);
    if (!fichaA || !fichaB) { resDiv.style.display = 'none'; return; }

    if (fichaA.tamanho !== fichaB.tamanho) {
        resDiv.style.display = 'block';
        resDiv.innerHTML = '<div class="alert alert-warning" style="margin:0">⚠️ Os dois sabores precisam ser do <strong>mesmo tamanho</strong>. Você escolheu ' + esc(fichaA.nome) + ' (' + fichaA.tamanho + ') e ' + esc(fichaB.nome) + ' (' + fichaB.tamanho + ').</div>';
        return;
    }

    // Atualizar custos antes de calcular
    atualizarCustosDaFicha(fichaA);
    atualizarCustosDaFicha(fichaB);

    // ===== REGRAS DE NEGÓCIO MEIO A MEIO =====
    // Preço de Venda: SEMPRE o valor do sabor mais caro
    const precoVenda = Math.max(fichaA.precoVenda, fichaB.precoVenda);

    // Custo de Produção (Insumos): soma da metade do custo de cada sabor
    const custoIngA = (fichaA.custoIng || 0) / 2;
    const custoIngB = (fichaB.custoIng || 0) / 2;
    const custoIngMeioAMeio = custoIngA + custoIngB;

    // Custo da massa: usa a massa do tamanho mais caro (ou média se tamanhos diferentes)
    // A massa é uma pizza inteira, não meia
    const custoMassaA = fichaA.custoMassa || 0;
    const custoMassaB = fichaB.custoMassa || 0;
    const custoMassa = Math.max(custoMassaA, custoMassaB);

    // Custo fixo: permanece o mesmo (é por pizza)
    const custoFixo = calcularCustoFixoPorPizza();

    // Custo Total de Produção
    const custoTotalProducao = custoIngMeioAMeio + custoMassa + custoFixo;

    // Lucro Real (já descontando taxas sobre a venda)
    const taxasVenda = precoVenda * taxaMediaVenda();
    const lucroReal = precoVenda - custoTotalProducao - taxasVenda;

    // CMV e Margem
    const cmv = precoVenda > 0 ? ((custoIngMeioAMeio + custoMassa) / precoVenda) * 100 : 0;
    const margem = precoVenda > 0 ? (lucroReal / precoVenda) * 100 : 0;

    // Identificar qual é o mais caro
    const maisCaroNome = fichaA.precoVenda >= fichaB.precoVenda ? fichaA.nome : fichaB.nome;

    resDiv.style.display = 'block';
    resDiv.innerHTML = `
        <div class="alert alert-info" style="margin-bottom:15px">
            🍕 <strong>Meio a Meio:</strong> ${esc(fichaA.nome)} + ${esc(fichaB.nome)}<br>
            <small>Preço cobrado pelo sabor mais caro: <strong>${esc(maisCaroNome)}</strong></small>
        </div>
        <table style="width:100%;margin:15px 0;font-size:0.9em">
            <tr style="background:#f8f9fa"><td colspan="3" style="padding:8px;font-weight:bold">📊 Decomposição do Custo</td></tr>
            <tr>
                <td style="padding:6px">½ ${esc(fichaA.nome)} (ingredientes):</td>
                <td style="text-align:right;padding:6px;color:#666">${brl((fichaA.custoIng || 0))} ÷ 2</td>
                <td style="text-align:right;padding:6px;font-weight:bold">${brl(custoIngA)}</td>
            </tr>
            <tr>
                <td style="padding:6px">½ ${esc(fichaB.nome)} (ingredientes):</td>
                <td style="text-align:right;padding:6px;color:#666">${brl((fichaB.custoIng || 0))} ÷ 2</td>
                <td style="text-align:right;padding:6px;font-weight:bold">${brl(custoIngB)}</td>
            </tr>
            <tr style="border-top:1px dashed #ccc">
                <td style="padding:6px">Custo Ingredientes (Meio a Meio):</td>
                <td></td>
                <td style="text-align:right;padding:6px;font-weight:bold;color:var(--danger)">${brl(custoIngMeioAMeio)}</td>
            </tr>
            <tr><td style="padding:6px">Massa:</td><td></td><td style="text-align:right;padding:6px">${brl(custoMassa)}</td></tr>
            <tr><td style="padding:6px">Custo Fixo:</td><td></td><td style="text-align:right;padding:6px">${brl(custoFixo)}</td></tr>
            ${taxasVenda > 0 ? `<tr><td style="padding:6px">Taxas sobre a venda (${pct(taxaMediaVenda() * 100)}):</td><td></td><td style="text-align:right;padding:6px">${brl(taxasVenda)}</td></tr>` : ''}
            <tr style="font-weight:bold;border-top:2px solid #333;background:#fff3e0">
                <td style="padding:8px">CUSTO TOTAL PRODUÇÃO:</td>
                <td></td>
                <td style="text-align:right;padding:8px;color:var(--danger);font-size:1.1em">${brl(custoTotalProducao)}</td>
            </tr>
        </table>
        <div class="resumo-box" style="margin-top:15px">
            <div class="resumo-grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))">
                <div class="resumo-item"><small>💰 Preço Venda</small><div class="val blue" style="font-size:1.3em">${brl(precoVenda)}</div></div>
                <div class="resumo-item"><small>📦 Custo Total</small><div class="val red">${brl(custoTotalProducao)}</div></div>
                <div class="resumo-item"><small>🎯 Lucro Real</small><div class="val ${lucroReal >= 0 ? 'green' : 'red'}" style="font-size:1.3em">${brl(lucroReal)}</div></div>
                <div class="resumo-item"><small>📊 CMV</small><div class="val ${cmv <= 30 ? 'green' : cmv <= 35 ? 'yellow' : 'red'}">${pct(cmv)}</div></div>
                <div class="resumo-item"><small>📈 Margem</small><div class="val ${margem >= 50 ? 'green' : margem >= 30 ? 'yellow' : 'red'}">${pct(margem)}</div></div>
            </div>
        </div>
        <div class="alert ${lucroReal >= 0 ? 'alert-success' : 'alert-warning'}" style="margin-top:15px">
            ${lucroReal >= 0 
                ? '✅ <strong>Meio a Meio viável!</strong> Lucro de ' + brl(lucroReal) + ' com margem de ' + pct(margem) + '.'
                : '⚠️ <strong>Atenção!</strong> Esta combinação gera prejuízo de ' + brl(Math.abs(lucroReal)) + '. Revise os preços.'
            }
        </div>`;
}

// ===== PRODUTOS PRONTOS (Bebidas e Adicionais) =====
let filtroProdCat = 'all';

function abrirModalProduto(id = null) {
    document.getElementById('modalProd').classList.add('show');
    document.getElementById('prodId').value = '';
    document.getElementById('prodNome').value = '';
    document.getElementById('prodCat').value = 'Bebida';
    document.getElementById('prodCusto').value = '';
    document.getElementById('prodVenda').value = '';
    document.getElementById('modalProdTitle').textContent = '🥤 Novo Produto';
    editandoProdutoId = null;

    if (id) {
        const prod = DB.produtosProntos.find(p => p.id === id);
        if (prod) {
            editandoProdutoId = id;
            document.getElementById('prodId').value = id;
            document.getElementById('prodNome').value = prod.nome;
            document.getElementById('prodCat').value = prod.categoria;
            document.getElementById('prodCusto').value = prod.precoCusto;
            document.getElementById('prodVenda').value = prod.precoVenda;
            document.getElementById('modalProdTitle').textContent = '✏️ Editar Produto';
        }
    }
    previewProduto();
}

function previewProduto() {
    const custo = parseFloat(document.getElementById('prodCusto').value) || 0;
    const venda = parseFloat(document.getElementById('prodVenda').value) || 0;
    const prev = document.getElementById('prodPreview');
    if (custo > 0 && venda > 0) {
        const lucro = venda - custo;
        const margem = (lucro / venda) * 100;
        prev.innerHTML = '💡 Lucro: <strong>' + brl(lucro) + '</strong> | Margem: <strong>' + pct(margem) + '</strong>';
        prev.style.color = lucro >= 0 ? 'var(--success)' : 'var(--danger)';
    } else {
        prev.innerHTML = '💡 Preencha custo e venda para ver';
        prev.style.color = '#666';
    }
}

function salvarProduto() {
    const nome = document.getElementById('prodNome').value.trim();
    const cat = document.getElementById('prodCat').value;
    const custo = parseFloat(document.getElementById('prodCusto').value) || 0;
    const venda = parseFloat(document.getElementById('prodVenda').value) || 0;

    if (!nome) { alert('⚠️ Preencha o nome do produto!'); return; }
    if (custo <= 0) { alert('⚠️ Informe o preço de custo!'); return; }
    if (venda <= 0) { alert('⚠️ Informe o preço de venda!'); return; }

    const prodData = {
        id: editandoProdutoId || gerarId(),
        nome,
        categoria: cat,
        precoCusto: custo,
        precoVenda: venda,
        lucro: venda - custo
    };

    if (editandoProdutoId) {
        const idx = DB.produtosProntos.findIndex(p => p.id === editandoProdutoId);
        if (idx !== -1) DB.produtosProntos[idx] = prodData;
        status('💾 Produto atualizado!');
    } else {
        DB.produtosProntos.push(prodData);
        status('💾 Produto salvo!');
    }

    editandoProdutoId = null;
    persistirDados(false);
    fecharModal('modalProd');
    renderProdutosProntos();
    renderDashboard();
}

function excluirProduto(id) {
    if (!confirm('Excluir este produto?')) return;
    DB.produtosProntos = DB.produtosProntos.filter(p => p.id !== id);
    persistirDados(false);
    renderProdutosProntos();
    renderDashboard();
    status('🗑️ Produto excluído!');
}

function renderProdutosProntos() {
    const tbody = document.getElementById('tblProdutos');
    if (!tbody) return;

    const prods = filtroProdCat === 'all'
        ? DB.produtosProntos
        : DB.produtosProntos.filter(p => p.categoria === filtroProdCat);

    // Atualizar contadores
    const cntProdAll = document.getElementById('cntProdAll');
    const cntProdBeb = document.getElementById('cntProdBeb');
    const cntProdCerv = document.getElementById('cntProdCerv');
    const cntProdDoce = document.getElementById('cntProdDoce');
    const cntProdAdic = document.getElementById('cntProdAdic');
    if (cntProdAll) cntProdAll.textContent = DB.produtosProntos.length;
    if (cntProdBeb) cntProdBeb.textContent = DB.produtosProntos.filter(p => p.categoria === 'Bebida').length;
    if (cntProdCerv) cntProdCerv.textContent = DB.produtosProntos.filter(p => p.categoria === 'Cerveja').length;
    if (cntProdDoce) cntProdDoce.textContent = DB.produtosProntos.filter(p => p.categoria === 'Doce').length;
    if (cntProdAdic) cntProdAdic.textContent = DB.produtosProntos.filter(p => p.categoria === 'Adicional').length;

    if (prods.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty"><div class="icon">🥤</div>Nenhum produto cadastrado</td></tr>';
        return;
    }

    tbody.innerHTML = prods.map(p => {
        const lucro = p.precoVenda - p.precoCusto;
        const margem = p.precoVenda > 0 ? (lucro / p.precoVenda) * 100 : 0;
        const catIcons = { 'Bebida': '🥤', 'Cerveja': '🍺', 'Doce': '🍫', 'Adicional': '➕' };
        return `<tr>
            <td><strong>${esc(p.nome)}</strong></td>
            <td><span class="badge badge-info">${catIcons[p.categoria] || '📦'} ${p.categoria}</span></td>
            <td>${brl(p.precoCusto)}</td>
            <td>${brl(p.precoVenda)}</td>
            <td><strong style="color:${lucro >= 0 ? 'var(--success)' : 'var(--danger)'}">${brl(lucro)}</strong><br><small>${pct(margem)}</small></td>
            <td class="actions">
                <button class="btn btn-info btn-sm" onclick="abrirModalProduto('${p.id}')">✏️</button>
                <button class="btn btn-danger btn-sm" onclick="excluirProduto('${p.id}')">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

function filtrarProdutos(cat, btn) {
    filtroProdCat = cat;
    document.querySelectorAll('.prod-cat-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderProdutosProntos();
}

function filtrarProdutosBusca() {
    const busca = document.getElementById('buscaProd').value.toLowerCase();
    document.querySelectorAll('#tblProdutos tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(busca) ? '' : 'none';
    });
}

// ===== SIMULADOR DE COMBOS VIP =====
function getComboAdicionaisOptions() {
    const adicionais = DB.produtosProntos.filter(p => p.categoria === 'Adicional' || p.categoria === 'Doce');
    return '<option value="">-- Selecione (opcional) --</option>' +
        adicionais.map(p => `<option value="${p.id}">${esc(p.nome)} - Venda: ${brl(p.precoVenda)}</option>`).join('');
}

function addComboAdicional(selectedId) {
    const container = document.getElementById('comboAdicionaisContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'combo-adicional-item';
    div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';
    div.innerHTML = `<select class="form-control" onchange="calcCombo()" style="flex:1">${getComboAdicionaisOptions()}</select><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcCombo()" style="flex-shrink:0;min-width:40px">✕</button>`;
    container.appendChild(div);

    if (selectedId) {
        div.querySelector('select').value = selectedId;
    }

    calcCombo();
}

function loadComboSelects() {
    const selPizza = document.getElementById('comboPizza');
    const selBebida = document.getElementById('comboBebida');
    if (!selPizza || !selBebida) return;

    // Pizza select (das fichas técnicas)
    const valPizza = selPizza.value;
    selPizza.innerHTML = '<option value="">-- Selecione a Pizza --</option>' +
        DB.fichas.map(f => {
            atualizarCustosDaFicha(f);
            return `<option value="${f.id}">${esc(f.nome)} (${f.tamanho}) - Venda: ${brl(f.precoVenda)}</option>`;
        }).join('');
    selPizza.value = DB.fichas.some((f) => f.id === valPizza) ? valPizza : '';

    // Bebida select (dos produtos prontos, categoria Bebida + Cerveja)
    const bebidas = DB.produtosProntos.filter(p => p.categoria === 'Bebida' || p.categoria === 'Cerveja');
    const valBebida = selBebida.value;
    selBebida.innerHTML = '<option value="">-- Selecione a Bebida --</option>' +
        bebidas.map(p => `<option value="${p.id}">${esc(p.nome)} - Venda: ${brl(p.precoVenda)}</option>`).join('');
    selBebida.value = bebidas.some((p) => p.id === valBebida) ? valBebida : '';

    // Atualizar options dos selects de adicionais já existentes
    const container = document.getElementById('comboAdicionaisContainer');
    if (container) {
        container.querySelectorAll('.combo-adicional-item select').forEach(sel => {
            const val = sel.value;
            sel.innerHTML = getComboAdicionaisOptions();
            sel.value = val;
        });
    }
}

function calcCombo() {
    const idPizza = document.getElementById('comboPizza').value;
    const idBebida = document.getElementById('comboBebida').value;
    const resDiv = document.getElementById('comboResultado');

    if (!idPizza || !idBebida) {
        resDiv.style.display = 'none';
        return;
    }

    const pizza = DB.fichas.find(f => f.id === idPizza);
    const bebida = DB.produtosProntos.find(p => p.id === idBebida);
    if (!pizza || !bebida) return;

    atualizarCustosDaFicha(pizza);

    // Varrer TODOS os selects de adicionais do container
    const adicionaisSelecionados = [];
    const container = document.getElementById('comboAdicionaisContainer');
    if (container) {
        container.querySelectorAll('.combo-adicional-item select').forEach(sel => {
            if (sel.value) {
                const prod = DB.produtosProntos.find(p => p.id === sel.value);
                if (prod) adicionaisSelecionados.push(prod);
            }
        });
    }

    // ===== CÁLCULOS DO COMBO =====
    const custoPizza = pizza.custoTotal || 0;
    const custoBebida = bebida.precoCusto || 0;

    let custoAdicionaisTotal = 0;
    let vendaAdicionaisTotal = 0;
    adicionaisSelecionados.forEach(a => {
        custoAdicionaisTotal += (a.precoCusto || 0);
        vendaAdicionaisTotal += (a.precoVenda || 0);
    });

    const custoTotalCombo = custoPizza + custoBebida + custoAdicionaisTotal;

    const vendaPizza = pizza.precoVenda || 0;
    const vendaBebida = bebida.precoVenda || 0;
    const somaVendasIndividuais = vendaPizza + vendaBebida + vendaAdicionaisTotal;

    // Preço promocional digitado
    const precoPromo = parseFloat(document.getElementById('comboPrecoPromo').value) || 0;
    const precoFinal = precoPromo > 0 ? precoPromo : somaVendasIndividuais;
    const desconto = somaVendasIndividuais - precoFinal;
    const descontoPerc = somaVendasIndividuais > 0 ? (desconto / somaVendasIndividuais) * 100 : 0;

    const taxasCombo = precoFinal * taxaMediaVenda();
    const lucroReal = precoFinal - custoTotalCombo - taxasCombo;
    const margem = precoFinal > 0 ? (lucroReal / precoFinal) * 100 : 0;
    const custoMercadoriaCombo = (pizza.custoIng || 0) + (pizza.custoMassa || 0) + custoBebida + custoAdicionaisTotal;
    const cmv = precoFinal > 0 ? (custoMercadoriaCombo / precoFinal) * 100 : 0;

    // Gerar linhas de adicionais para as tabelas
    const adicionaisCustoHTML = adicionaisSelecionados.map(a => {
        const icon = a.categoria === 'Doce' ? '🍫' : '➕';
        return `<tr>
            <td style="padding:6px">${icon} ${esc(a.nome)} (custo compra):</td>
            <td></td>
            <td style="text-align:right;padding:6px;font-weight:bold">${brl((a.precoCusto || 0))}</td>
        </tr>`;
    }).join('');

    const adicionaisVendaHTML = adicionaisSelecionados.map(a => {
        const icon = a.categoria === 'Doce' ? '🍫' : '➕';
        return `<tr><td style="padding:6px">${icon} ${esc(a.nome)}:</td><td style="text-align:right;padding:6px">${brl((a.precoVenda || 0))}</td></tr>`;
    }).join('');

    const nomesAdicionais = adicionaisSelecionados.map(a => a.nome).join(' + ');
    const comboDescricao = pizza.nome + ' + ' + bebida.nome + (nomesAdicionais ? ' + ' + nomesAdicionais : '');

    resDiv.style.display = 'block';
    resDiv.innerHTML = `
        <div class="alert alert-info" style="margin-bottom:15px">
            🎯 <strong>Combo:</strong> ${esc(comboDescricao)}
        </div>
        <table style="width:100%;margin:10px 0;font-size:0.9em">
            <tr style="background:#f8f9fa"><td colspan="3" style="padding:8px;font-weight:bold">📊 Decomposição de Custos</td></tr>
            <tr>
                <td style="padding:6px">🍕 ${esc(pizza.nome)} (custo produção):</td>
                <td></td>
                <td style="text-align:right;padding:6px;font-weight:bold">${brl(custoPizza)}</td>
            </tr>
            <tr>
                <td style="padding:6px">🥤 ${esc(bebida.nome)} (custo compra):</td>
                <td></td>
                <td style="text-align:right;padding:6px;font-weight:bold">${brl(custoBebida)}</td>
            </tr>
            ${adicionaisCustoHTML}
            <tr style="font-weight:bold;border-top:2px solid #333;background:#fff3e0">
                <td style="padding:8px">CUSTO TOTAL DO COMBO:</td>
                <td></td>
                <td style="text-align:right;padding:8px;color:var(--danger);font-size:1.1em">${brl(custoTotalCombo)}</td>
            </tr>
            ${taxasCombo > 0 ? `<tr><td style="padding:6px">Taxas sobre a venda (${pct(taxaMediaVenda() * 100)}):</td><td></td><td style="text-align:right;padding:6px;font-weight:bold">${brl(taxasCombo)}</td></tr>` : ''}
        </table>
        <table style="width:100%;margin:10px 0;font-size:0.9em">
            <tr style="background:#e8f5e9"><td colspan="2" style="padding:8px;font-weight:bold">💰 Preços de Venda Individuais</td></tr>
            <tr><td style="padding:6px">🍕 ${esc(pizza.nome)}:</td><td style="text-align:right;padding:6px">${brl(vendaPizza)}</td></tr>
            <tr><td style="padding:6px">🥤 ${esc(bebida.nome)}:</td><td style="text-align:right;padding:6px">${brl(vendaBebida)}</td></tr>
            ${adicionaisVendaHTML}
            <tr style="border-top:1px solid #ccc"><td style="padding:6px;font-weight:bold">Soma Individual:</td><td style="text-align:right;padding:6px;font-weight:bold">${brl(somaVendasIndividuais)}</td></tr>
            ${precoPromo > 0 ? `<tr style="background:#fff8e1"><td style="padding:6px;font-weight:bold;color:#e65100">🏷️ Desconto Promocional:</td><td style="text-align:right;padding:6px;font-weight:bold;color:#e65100">- ${brl(desconto)} (${pct(descontoPerc)})</td></tr>` : ''}
        </table>
        <div class="resumo-box" style="margin-top:15px">
            <div class="resumo-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr))">
                <div class="resumo-item"><small>💰 Preço Combo</small><div class="val blue" style="font-size:1.3em">${brl(precoFinal)}</div></div>
                <div class="resumo-item"><small>📦 Custo Total</small><div class="val red">${brl(custoTotalCombo)}</div></div>
                <div class="resumo-item"><small>🎯 Lucro Real</small><div class="val ${lucroReal >= 0 ? 'green' : 'red'}" style="font-size:1.3em">${brl(lucroReal)}</div></div>
                <div class="resumo-item"><small>📈 Margem</small><div class="val ${margem >= 50 ? 'green' : margem >= 30 ? 'yellow' : 'red'}">${pct(margem)}</div></div>
                <div class="resumo-item"><small>📊 CMV</small><div class="val ${cmv <= 30 ? 'green' : cmv <= 35 ? 'yellow' : 'red'}">${pct(cmv)}</div></div>
            </div>
        </div>
        <div class="alert ${lucroReal >= 0 ? 'alert-success' : 'alert-warning'}" style="margin-top:15px">
            ${lucroReal >= 0
                ? '✅ <strong>Combo viável!</strong> Lucro de ' + brl(lucroReal) + ' com margem de ' + pct(margem) + '.'
                  + (precoPromo > 0 && desconto > 0 ? ' Desconto de ' + pct(descontoPerc) + ' sobre o preço individual.' : '')
                : '⚠️ <strong>Atenção!</strong> Este combo gera prejuízo de ' + brl(Math.abs(lucroReal)) + '. Aumente o preço promocional.'
            }
        </div>`;
}

// ===== EXPORT/IMPORT =====
function exportar() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pizzacontrol_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    status('📥 Exportado!');
}

function importar(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const d = normalizarDados(JSON.parse(ev.target.result));
            const resumo = d.insumos.length + ' insumos, ' + d.fichas.length + ' fichas e ' + d.produtosProntos.length + ' produtos';
            if (!confirm('Restaurar este backup (' + resumo + ')?\n\n⚠️ Os dados atuais deste aparelho serão SUBSTITUÍDOS pelos do arquivo.')) {
                e.target.value = '';
                return;
            }

            DB = d;
            persistirDados(false);
            sincronizarUI();
            loadMassaUI();
            loadCustosUI();
            loadConfigUI();
            status('✅ Dados importados!');
        } catch (err) {
            console.error(err);
            alert('❌ Erro ao importar arquivo!');
        }
    };

    reader.readAsText(file);
    e.target.value = '';
}

function limparTudo() {
    if (!confirm('⚠️ Apagar TUDO?')) return;
    if (confirm('Backup antes?')) exportar();

    DB = clonar(DB_PADRAO);
    persistirDados(false);
    loadMassaUI();
    loadCustosUI();
    loadConfigUI();
    limparFicha();
    sincronizarUI();
    status('🧹 Dados locais apagados!');
}

// ===== MODAIS =====
document.querySelectorAll('.modal-bg').forEach((m) => {
    m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.remove('show');
    });
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-bg.show').forEach((m) => m.classList.remove('show'));
    }
});

// ===== CONFIG =====
function salvarConfig() {
    const nomePizzaria = document.getElementById('configNome').value.trim();
    const meta = parseFloat(document.getElementById('configMeta').value) || 15000;

    DB.config = { nomePizzaria, meta };
    persistirDados(true, '✅ Configurações salvas!');
    loadConfigUI();
    renderDashboard();
}

// ===== PRECIFICAR (MARKUP) =====
function calcPorMarkup() {
    const custo = parseFloat(document.getElementById('calcCusto').value) || 0;
    const markup = parseFloat(document.getElementById('calcMarkup').value) || 3;
    const impostoP = parseFloat(document.getElementById('calcImposto').value) || 0;

    if (custo > 0) {
        const precoSugerido = custo * markup;
        const totalImposto = precoSugerido * (impostoP / 100);
        const lucroBruto = precoSugerido - custo;
        const lucroLiquido = lucroBruto - totalImposto;

        document.getElementById('calcPreco').textContent = brl(precoSugerido);
        document.getElementById('calcLucro').textContent = 'Lucro Bruto: ' + brl(lucroBruto);
        const llElem = document.getElementById('calcLucroReal');
        if (llElem) {
            llElem.textContent =
                'Lucro Líquido (Pós Imposto): ' +
                brl(lucroLiquido) +
                ' (' +
                pct(precoSugerido > 0 ? (lucroLiquido / precoSugerido) * 100 : 0) +
                ')';
        }
    } else {
        document.getElementById('calcPreco').textContent = 'R$ 0,00';
        document.getElementById('calcLucro').textContent = 'Lucro Bruto: R$ 0,00';
        const elem = document.getElementById('calcLucroReal');
        if (elem) elem.textContent = 'Lucro Líquido (Pós Imposto): R$ 0,00 (-)';
    }
}

// ===== TRAVA DE PLANOS (BÁSICO vs PRO) =====
// Abas exclusivas do plano PRO. O plano Básico mantém: dashboard, insumos, fichas, nova-ficha, config.
const ABAS_EXCLUSIVAS_PRO = ['massa', 'custos', 'produtos', 'precificar'];

const NOMES_RECURSOS_PRO = {
    massa: '🥖 Cálculo de Massa por Tamanho',
    custos: '💼 Rateio de Custo Fixo (o que faz você parar de pagar pra trabalhar)',
    produtos: '🥤 Cadastro de Bebidas',
    precificar: '💰 Gerador de Preço, Combos e Meio a Meio',
    backup: '💾 Backup (Exportar/Importar Dados)'
};

function aplicarTravaPlanos() {
    injetarEstilosTravaPlanos();

    if (isPro) return; // Plano PRO tem acesso total, nada a travar.

    // --- 1. Travar as abas inteiras exclusivas do PRO no menu lateral ---
    document.querySelectorAll('.nav-tab').forEach((tab) => {
        const pagina = tab.dataset.page;
        if (!ABAS_EXCLUSIVAS_PRO.includes(pagina)) return;

        tab.classList.add('nav-tab-locked');
        if (!tab.querySelector('.lock-pro-badge')) {
            const badge = document.createElement('span');
            badge.className = 'lock-pro-badge';
            badge.textContent = '🔒';
            tab.appendChild(badge);
        }

        // Fase de captura: intercepta o clique ANTES do listener de navegação normal
        // (registrado em setupNav), então a página PRO nunca chega a ser exibida.
        tab.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            mostrarModalUpgrade(pagina);
        }, true);
    });

    // --- 2. Travar Exportar / Importar (Backup) ---
    const btnExportar = document.querySelector('button[onclick="exportar()"]');
    if (btnExportar) {
        btnExportar.textContent = '🔒 Recurso PRO';
        btnExportar.className = 'btn btn-secondary';
        btnExportar.removeAttribute('onclick');
        btnExportar.addEventListener('click', function (e) {
            e.preventDefault();
            mostrarModalUpgrade('backup');
        });
    }

    const lblImportar = document.querySelector('label.btn.btn-warning');
    if (lblImportar) {
        const inputFile = lblImportar.querySelector('input[type="file"]');
        if (inputFile) inputFile.remove();
        lblImportar.textContent = '🔒 Recurso PRO';
        lblImportar.className = 'btn btn-secondary';
        lblImportar.style.cursor = 'pointer';
        lblImportar.addEventListener('click', function (e) {
            e.preventDefault();
            mostrarModalUpgrade('backup');
        });
    }

    // --- 3. No Básico o lucro da ficha não inclui custo fixo: o rótulo diz isso ---
    // (o resumo por tamanho já mostra "Lucro (sem custo fixo)" e esconde taxas/meta no Básico)
    if (document.getElementById('ficIngLista')) calcFicha();

    // --- 4. Aviso dentro de "Criar Ficha": Custo Fixo e Massa não incluídos no Básico ---
    injetarAvisoFichaBasico();

    console.log('🔒 Travas do Plano Básico aplicadas às abas:', ABAS_EXCLUSIVAS_PRO.join(', '));
}

function escaparHtmlUpgrade(t) {
    return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fecharModalUpgrade() {
    const overlay = document.getElementById('modalUpgradePro');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', fecharModalUpgradeEsc);
}

function fecharModalUpgradeEsc(e) {
    if (e.key === 'Escape') fecharModalUpgrade();
}

function mostrarModalUpgrade(origem) {
    fecharModalUpgrade();
    const nome = NOMES_RECURSOS_PRO[origem] || 'Este recurso';
    const email = (firebaseUser && firebaseUser.email) ? firebaseUser.email : '';

    const overlay = document.createElement('div');
    overlay.id = 'modalUpgradePro';
    overlay.className = 'mup-overlay';
    overlay.innerHTML = `
        <div class="mup-card" role="dialog" aria-modal="true" aria-labelledby="mupTitulo">
            <button type="button" class="mup-fechar" aria-label="Fechar">✕</button>
            <div class="mup-topo">
                <div class="mup-cadeado">🔒</div>
                <div class="mup-selo">RECURSO PRO</div>
                <h2 id="mupTitulo" class="mup-titulo">${escaparHtmlUpgrade(nome)}</h2>
            </div>
            <div class="mup-corpo">
                <p class="mup-texto">Pare de vender no prejuízo sem saber. Com o PRO você descobre o <strong>lucro real</strong> de cada pizza.</p>
                <ul class="mup-lista">
                    <li>✅ Rateio de Custo Fixo (aluguel, luz, funcionários)</li>
                    <li>✅ Custo real da Massa por tamanho</li>
                    <li>✅ Gerador de Preço, Combos e Meio a Meio</li>
                    <li>✅ Bebidas, adicionais e Backup</li>
                </ul>
                <div class="mup-preco">
                    <span class="mup-valor">R$ 15,99</span>
                    <span class="mup-legenda">pagamento único · acesso vitalício</span>
                </div>
                ${email ? `
                <div class="mup-email">
                    <div class="mup-email-titulo">⚠️ Use este e-mail no pagamento para liberar na hora:</div>
                    <div class="mup-email-linha">
                        <span class="mup-email-valor">${escaparHtmlUpgrade(email)}</span>
                        <button type="button" class="mup-copiar">Copiar</button>
                    </div>
                </div>` : ''}
                <a class="mup-cta" href="${LINK_UPGRADE_PRO}" target="_blank" rel="noopener">QUERO LIBERAR O PRO</a>
                <button type="button" class="mup-depois">Agora não</button>
                <p class="mup-rodape">Depois de pagar, saia e entre de novo no sistema para ver tudo liberado.</p>
            </div>
        </div>`;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModalUpgrade(); });
    overlay.querySelector('.mup-fechar').addEventListener('click', fecharModalUpgrade);
    overlay.querySelector('.mup-depois').addEventListener('click', fecharModalUpgrade);
    const btnCopiar = overlay.querySelector('.mup-copiar');
    if (btnCopiar) {
        btnCopiar.addEventListener('click', () => {
            const ok = () => { btnCopiar.textContent = 'Copiado ✓'; setTimeout(() => { btnCopiar.textContent = 'Copiar'; }, 2000); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(email).then(ok).catch(() => prompt('Copie seu e-mail:', email));
            } else {
                prompt('Copie seu e-mail:', email);
            }
        });
    }
    document.addEventListener('keydown', fecharModalUpgradeEsc);
    document.body.appendChild(overlay);
}

function injetarAvisoFichaBasico() {
    if (document.getElementById('avisoFichaBasico')) return;
    const resumoBox = document.querySelector('#page-nova-ficha .resumo-box');
    if (!resumoBox) return;

    const aviso = document.createElement('div');
    aviso.id = 'avisoFichaBasico';
    aviso.className = 'aviso-upgrade-pro';
    aviso.innerHTML = '🔒 Este cálculo <strong>não inclui</strong> seu Custo Fixo real (aluguel, luz, funcionários) nem o custo real da sua Massa. Ative o PRO para ver seu Lucro Real.';
    aviso.addEventListener('click', function () {
        mostrarModalUpgrade('custos');
    });
    resumoBox.appendChild(aviso);
}

function injetarEstilosTravaPlanos() {
    if (document.getElementById('travaPlanosStyles')) return;
    const style = document.createElement('style');
    style.id = 'travaPlanosStyles';
    style.textContent = `
        .nav-tab-locked { opacity: 0.6; position: relative; }
        .nav-tab-locked:hover { opacity: 0.9; }
        .lock-pro-badge { margin-left: 6px; font-size: 0.85em; }
        .aviso-upgrade-pro {
            text-align:center; padding:12px 16px; margin-top:14px;
            background:linear-gradient(135deg,#fff3e0,#ffe0b2); border-radius:8px;
            border:1px solid #ffcc80; cursor:pointer; font-size:0.9em;
            color:#e65100; font-weight:600;
        }
        .aviso-upgrade-pro:hover { filter: brightness(0.97); }
        .meta-item { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid #eee; }
        .meta-item:last-child { border-bottom:0; }
        .meta-nome small { color:#666; }
        .meta-ideal { text-align:right; white-space:nowrap; }
        .meta-ideal small { display:block; color:#777; font-size:0.75rem; }
        .meta-ideal strong { display:block; color:#2e7d32; font-size:1.15rem; }
        .meta-ideal .meta-dif { color:#e65100; font-weight:700; font-size:0.8rem; }
        .mup-overlay {
            position:fixed; inset:0; z-index:99999; background:rgba(15,15,25,0.72);
            display:flex; align-items:center; justify-content:center; padding:16px;
            animation:mupFade .2s ease;
        }
        .mup-card {
            position:relative; width:100%; max-width:420px; max-height:92vh; overflow-y:auto;
            background:#fff; border-radius:18px; box-shadow:0 20px 60px rgba(0,0,0,.4);
            font-family:inherit; animation:mupSobe .25s ease;
        }
        .mup-fechar {
            position:absolute; top:10px; right:12px; background:rgba(255,255,255,.2); color:#fff;
            border:none; width:32px; height:32px; border-radius:50%; font-size:16px; cursor:pointer;
        }
        .mup-fechar:hover { background:rgba(255,255,255,.35); }
        .mup-topo {
            background:linear-gradient(135deg,#c62828,#8e0000); color:#fff; text-align:center;
            padding:26px 20px 20px; border-radius:18px 18px 0 0;
        }
        .mup-cadeado { font-size:40px; line-height:1; }
        .mup-selo {
            display:inline-block; margin-top:10px; background:#f6c90e; color:#1a202c;
            font-weight:800; font-size:11px; letter-spacing:1px; padding:4px 10px; border-radius:20px;
        }
        .mup-titulo { margin:10px 0 0; font-size:1.15rem; line-height:1.35; color:#fff; }
        .mup-corpo { padding:20px 22px 22px; }
        .mup-texto { margin:0 0 14px; color:#4a5568; font-size:.95rem; text-align:center; }
        .mup-lista { list-style:none; padding:0; margin:0 0 16px; display:flex; flex-direction:column; gap:8px; }
        .mup-lista li { color:#2d3748; font-size:.9rem; }
        .mup-preco { text-align:center; margin-bottom:16px; }
        .mup-valor { display:block; font-size:2.2rem; font-weight:900; color:#c62828; line-height:1.1; }
        .mup-legenda { font-size:.8rem; color:#718096; }
        .mup-email { background:#fff8e1; border:1px solid #ffe082; border-radius:10px; padding:10px 12px; margin-bottom:16px; }
        .mup-email-titulo { font-size:.8rem; color:#8d6e00; font-weight:600; margin-bottom:6px; }
        .mup-email-linha { display:flex; align-items:center; gap:8px; }
        .mup-email-valor { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; color:#1a202c; font-size:.9rem; }
        .mup-copiar { background:#1a202c; color:#fff; border:none; border-radius:6px; padding:6px 10px; font-size:.78rem; cursor:pointer; white-space:nowrap; }
        .mup-cta {
            display:block; text-align:center; text-decoration:none; background:linear-gradient(135deg,#e53935,#c62828);
            color:#fff; font-weight:800; font-size:1rem; padding:15px; border-radius:10px;
            box-shadow:0 6px 18px rgba(198,40,40,.35); transition:transform .15s;
        }
        .mup-cta:hover { transform:translateY(-2px); color:#fff; }
        .mup-cta:focus-visible { outline:3px solid #f6c90e; outline-offset:2px; }
        .mup-depois { display:block; width:100%; margin-top:8px; background:none; border:none; color:#718096; font-size:.9rem; padding:8px; cursor:pointer; }
        .mup-depois:hover { color:#2d3748; }
        .mup-rodape { margin:6px 0 0; text-align:center; font-size:.75rem; color:#a0aec0; }
        @keyframes mupFade { from { opacity:0; } to { opacity:1; } }
        @keyframes mupSobe { from { transform:translateY(20px); opacity:0; } to { transform:none; opacity:1; } }
    `;
    document.head.appendChild(style);
}
