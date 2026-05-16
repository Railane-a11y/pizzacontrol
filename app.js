console.log('🍕 APP.JS CARREGADO - MODO SAAS FIREBASE + LOCALSTORAGE');

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
let assinaturaDataVencimento = null;

const DB_PADRAO = {
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
    produtosProntos: []
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
    try {
        const doc = await dbFirestore.collection('usuarios').doc(uid).get();
        if (!doc.exists) {
            console.warn('⚠️ Documento do usuário não encontrado no Firestore:', uid);
            return false;
        }

        const dados = doc.data();
        if (!dados.dataVencimento) {
            console.warn('⚠️ Campo dataVencimento não encontrado para:', uid);
            return false;
        }

        let dataVenc;
        if (dados.dataVencimento.toDate) {
            // Firestore Timestamp
            dataVenc = dados.dataVencimento.toDate();
        } else {
            // String YYYY-MM-DD
            dataVenc = new Date(dados.dataVencimento + 'T23:59:59');
        }

        assinaturaDataVencimento = dataVenc;
        const agora = new Date();
        const valido = agora <= dataVenc;

        console.log('📅 Assinatura:', valido ? '✅ Válida' : '❌ Expirada', '| Vence em:', dataVenc.toLocaleDateString('pt-BR'));
        return valido;
    } catch (err) {
        console.error('❌ Erro ao verificar assinatura:', err);
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
    renderAll();
    loadMassaUI();
    loadCustosUI();
    loadConfigUI();

    const listaFicha = document.getElementById('ficIngLista');
    if (listaFicha) {
        listaFicha.innerHTML = '';
        addIngFicha();
        calcFicha();
    }

    refreshIngSelects();
    refreshMassaSelects();
    loadFichasSelect();

    // Exibir info da conta na aba Config
    const contaEmail = document.getElementById('contaEmail');
    const contaVenc = document.getElementById('contaVencimento');
    if (contaEmail && firebaseUser) contaEmail.textContent = firebaseUser.email;
    if (contaVenc && assinaturaDataVencimento) {
        contaVenc.textContent = assinaturaDataVencimento.toLocaleDateString('pt-BR');
    }
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
              const custoUn = numero(i.custoUn, qtdEmb > 0 ? precoEmb / qtdEmb : 0);
              return {
                  id: String(i.id || gerarId()),
                  nome: (i.nome || '').trim(),
                  categoria: i.categoria || 'Outros',
                  unidade: i.unidade || 'g',
                  qtdEmb,
                  precoEmb,
                  custoUn
              };
          })
        : [];

    const fichas = Array.isArray(origem.fichas)
        ? origem.fichas.map((f) => ({
              id: String(f.id || gerarId()),
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

    return { insumos, fichas, custos, massa, config, produtosProntos };
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
        persistirDados(false);
        return;
    }

    try {
        const raw = JSON.parse(encontrado.valor);
        DB = normalizarDados(raw);

        if (encontrado.key !== STORAGE_KEY) {
            persistirDados(false);
        }
    } catch (err) {
        console.error('Erro ao carregar dados locais:', err);
        DB = clonar(DB_PADRAO);
        persistirDados(false);
    }
}

function persistirDados(mostrarStatus = true, mensagem = '💾 Dados salvos no navegador!') {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
        if (mostrarStatus) status(mensagem);
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

function fazerLogout() {
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
    if (hdrCustoFixo) hdrCustoFixo.textContent = 'R$ ' + calcularCustoFixoPorPizza().toFixed(2);
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

function setupNav() {
    document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('page-' + tab.dataset.page).classList.add('active');
            if (tab.dataset.page === 'nova-ficha') refreshIngSelects();
            if (tab.dataset.page === 'massa') {
                refreshMassaSelects();
                calcMassa();
            }
            if (tab.dataset.page === 'precificar') { loadFichasSelect(); loadFichasSelectMeioAMeio(); loadComboSelects(); }
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

    const custoUn = preco / qtd;
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
}

function excluirInsumo(id) {
    if (!confirm('Excluir insumo?')) return;

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
                `<tr><td><strong>${i.nome}</strong></td><td><span class="badge badge-info">${i.categoria}</span></td><td>${i.unidade}</td><td>${i.qtdEmb}</td><td>R$ ${(i.precoEmb || 0).toFixed(2)}</td><td><strong style="color:var(--primary)">R$ ${(i.custoUn || 0).toFixed(4)}</strong></td><td class="actions"><button class="btn btn-info btn-sm" onclick="abrirModalInsumo('${i.id}')">✏️</button><button class="btn btn-danger btn-sm" onclick="excluirInsumo('${i.id}')">🗑️</button></td></tr>`
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
        qtd > 0 && preco > 0 ? '💡 Custo: <strong>R$ ' + (preco / qtd).toFixed(4) + '</strong>/' + un : '💡 Preencha para ver';
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

    document.getElementById('cfTotal').textContent = 'R$ ' + total.toFixed(2);
    document.getElementById('cfPorPizza').textContent = 'R$ ' + calcularCustoFixoPorPizza().toFixed(2);

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
        sel.innerHTML = '<option value="">Selecione...</option>' + DB.insumos.map((i) => `<option value="${i.id}">${i.nome}</option>`).join('');
        sel.value = val;
    });
}

function addIngMassa(insId = null, qtd = null) {
    const lista = document.getElementById('massaIngLista');
    const div = document.createElement('div');
    div.className = 'massa-item';
    div.innerHTML = `<select class="form-control" onchange="calcMassa()"><option value="">Selecione...</option>${DB.insumos
        .map((i) => `<option value="${i.id}" ${insId == i.id ? 'selected' : ''}>${i.nome}</option>`)
        .join('')}</select><input type="number" class="form-control" placeholder="Qtd (g)" value="${qtd || ''}" oninput="calcMassa()"><span class="custo">R$ 0</span><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcMassa()">✕</button>`;
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
                span.textContent = 'R$ ' + custo.toFixed(2);
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

    document.getElementById('massaCustoTotal').textContent = 'R$ ' + custoTotal.toFixed(2);
    document.getElementById('massaPesoTotalRes').textContent = pesoTotal + ' g';
    document.getElementById('massaCustoGrama').textContent = 'R$ ' + cpg.toFixed(4);
    document.getElementById('massaCustoP').textContent = 'R$ ' + (cpg * pesoP).toFixed(2);
    document.getElementById('massaCustoM').textContent = 'R$ ' + (cpg * pesoM).toFixed(2);
    document.getElementById('massaCustoG').textContent = 'R$ ' + (cpg * pesoG).toFixed(2);
    document.getElementById('massaCustoGG').textContent = 'R$ ' + (cpg * pesoGG).toFixed(2);
    document.getElementById('massaInfoP').textContent = pesoP + 'g × R$' + cpg.toFixed(4);
    document.getElementById('massaInfoM').textContent = pesoM + 'g × R$' + cpg.toFixed(4);
    document.getElementById('massaInfoG').textContent = pesoG + 'g × R$' + cpg.toFixed(4);
    document.getElementById('massaInfoGG').textContent = pesoGG + 'g × R$' + cpg.toFixed(4);
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

// ===== FICHAS =====
function refreshIngSelects() {
    document.querySelectorAll('#ficIngLista select').forEach((sel) => {
        const val = sel.value;
        sel.innerHTML =
            '<option value="">Selecione...</option>' +
            DB.insumos.map((i) => `<option value="${i.id}">${i.nome} (R$${(i.custoUn || 0).toFixed(4)}/${i.unidade})</option>`).join('');
        sel.value = val;
    });
}

function addIngFicha(insId = null, qtd = null) {
    const lista = document.getElementById('ficIngLista');
    const div = document.createElement('div');
    div.className = 'ingrediente-item';
    div.innerHTML = `<select class="form-control" onchange="calcFicha()"><option value="">Selecione...</option>${DB.insumos
        .map((i) => `<option value="${i.id}" ${insId == i.id ? 'selected' : ''}>${i.nome} (R$${(i.custoUn || 0).toFixed(4)}/${i.unidade})</option>`)
        .join('')}</select><input type="number" class="form-control" placeholder="Qtd" value="${qtd || ''}" oninput="calcFicha()"><span class="custo">R$ 0</span><button class="btn btn-danger btn-sm" onclick="this.parentElement.remove();calcFicha()">✕</button>`;
    lista.appendChild(div);
    if (qtd) setTimeout(calcFicha, 50);
}

function calcFicha() {
    let custoIng = 0;
    document.querySelectorAll('#ficIngLista .ingrediente-item').forEach((item) => {
        const sel = item.querySelector('select');
        const inp = item.querySelector('input');
        const span = item.querySelector('.custo');
        const id = sel.value;
        const qtd = parseFloat(inp.value) || 0;

        if (id && qtd > 0) {
            const ins = DB.insumos.find((i) => i.id == id);
            if (ins) {
                const custo = (ins.custoUn || 0) * qtd;
                custoIng += custo;
                span.textContent = 'R$ ' + custo.toFixed(2);
            }
        } else {
            span.textContent = 'R$ 0';
        }
    });

    const tam = document.getElementById('ficTam').value;
    const incMassa = document.getElementById('ficMassa').value === '1';
    const custoMassa = incMassa ? getCustoMassa(tam) : 0;
    const custoFixo = calcularCustoFixoPorPizza();
    const custoTotal = custoIng + custoMassa + custoFixo;
    const venda = parseFloat(document.getElementById('ficPreco').value) || 0;
    const lucro = venda - custoTotal;
    const cmv = venda > 0 ? (custoTotal / venda) * 100 : 0;
    const margem = venda > 0 ? (lucro / venda) * 100 : 0;

    document.getElementById('resIng').textContent = 'R$ ' + custoIng.toFixed(2);
    document.getElementById('resMassa').textContent = 'R$ ' + custoMassa.toFixed(2);
    document.getElementById('resCF').textContent = 'R$ ' + custoFixo.toFixed(2);
    document.getElementById('resTotal').textContent = 'R$ ' + custoTotal.toFixed(2);
    document.getElementById('resVenda').textContent = 'R$ ' + venda.toFixed(2);
    document.getElementById('resLucro').textContent = 'R$ ' + lucro.toFixed(2);
    document.getElementById('resLucro').className = 'val ' + (lucro >= 0 ? 'green' : 'red');
    document.getElementById('resCMV').textContent = cmv.toFixed(1) + '%';
    document.getElementById('resMargem').textContent = margem.toFixed(1) + '%';

    const bar = document.getElementById('cmvBar');
    bar.style.width = Math.min(cmv, 100) + '%';
    bar.className = 'cmv-fill ' + (cmv <= 30 ? 'good' : cmv <= 35 ? 'medium' : 'bad');
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
    const tam = document.getElementById('ficTam').value;
    const preco = parseFloat(document.getElementById('ficPreco').value) || 0;
    const incMassa = document.getElementById('ficMassa').value === '1';

    if (!nome || preco <= 0) {
        alert('⚠️ Preencha nome e preço!');
        return;
    }

    const ingredientes = [];
    let custoIng = 0;
    document.querySelectorAll('#ficIngLista .ingrediente-item').forEach((item) => {
        const id = item.querySelector('select').value;
        const qtd = parseFloat(item.querySelector('input').value) || 0;
        if (id && qtd > 0) {
            const ins = DB.insumos.find((i) => i.id == id);
            if (ins) {
                const custo = (ins.custoUn || 0) * qtd;
                custoIng += custo;
                ingredientes.push({
                    insumoId: id,
                    nome: ins.nome,
                    quantidade: qtd,
                    unidade: ins.unidade,
                    custo
                });
            }
        }
    });

    if (ingredientes.length === 0) {
        alert('⚠️ Adicione ingredientes!');
        return;
    }

    const custoMassa = incMassa ? getCustoMassa(tam) : 0;
    const custoFixo = calcularCustoFixoPorPizza();
    const custoTotal = custoIng + custoMassa + custoFixo;
    const fichaData = {
        id: editandoFichaId || gerarId(),
        nome,
        categoria: cat,
        tamanho: tam,
        precoVenda: preco,
        incMassa,
        ingredientes,
        custoIng,
        custoMassa,
        custoFixo,
        custoTotal,
        lucro: preco - custoTotal,
        cmv: (custoTotal / preco) * 100
    };

    if (editandoFichaId) {
        const idx = DB.fichas.findIndex((f) => f.id === editandoFichaId);
        if (idx !== -1) DB.fichas[idx] = fichaData;
        status('💾 Ficha Atualizada!');
    } else {
        DB.fichas.push(fichaData);
        status('💾 Ficha Salva!');
    }

    persistirDados(false);
    limparFichaPosSalvar();
    sincronizarUI();
}

function limparFicha() {
    editandoFichaId = null;
    document.getElementById('ficNome').value = '';
    document.getElementById('ficPreco').value = '';
    document.getElementById('ficIngLista').innerHTML = '';
    document.getElementById('fichaHeader').textContent = '➕ Nova Ficha Técnica';
    document.getElementById('fichaHeader').style.background = '';
    document.getElementById('ficCat').value = 'Tradicional';
    document.getElementById('ficTam').value = 'G';
    document.getElementById('ficMassa').value = '1';
    addIngFicha();
    calcFicha();
}

function editarFicha(id) {
    const f = DB.fichas.find((x) => x.id === id);
    if (!f) return;

    editandoFichaId = id;
    document.getElementById('ficNome').value = f.nome;
    document.getElementById('ficCat').value = f.categoria;
    document.getElementById('ficTam').value = f.tamanho;
    document.getElementById('ficPreco').value = f.precoVenda;
    document.getElementById('ficMassa').value = f.incMassa !== false ? '1' : '0';
    document.getElementById('ficIngLista').innerHTML = '';
    (f.ingredientes || []).forEach((ing) => addIngFicha(ing.insumoId, ing.quantidade));
    calcFicha();
    document.getElementById('fichaHeader').textContent = '✏️ Editando: ' + f.nome;
    document.getElementById('fichaHeader').style.background = 'linear-gradient(135deg, #ff9800, #e65100)';
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.querySelector('[data-page="nova-ficha"]').classList.add('active');
    document.getElementById('page-nova-ficha').classList.add('active');
    refreshIngSelects();
    window.scrollTo(0, 0);
}

function excluirFicha(id) {
    if (!confirm('Excluir?')) return;

    DB.fichas = DB.fichas.filter((f) => f.id !== id);
    persistirDados(false);
    sincronizarUI();
    status('🗑️ Excluída!');
}

function duplicarFicha(id) {
    const f = DB.fichas.find((x) => x.id === id);
    if (!f) return;

    const copy = clonar(f);
    copy.id = gerarId();
    copy.nome = copy.nome + ' (Cópia)';
    DB.fichas.push(copy);

    persistirDados(false);
    sincronizarUI();
    status('📋 Duplicada!');
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
    f.lucro = f.precoVenda - f.custoTotal;
    f.cmv = f.precoVenda > 0 ? (f.custoTotal / f.precoVenda) * 100 : 0;
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
                `<div class="ficha-card ${f.tamanho}"><div class="ficha-header"><div><h3>${f.nome}</h3><small>${f.categoria}</small></div><span class="badge-size ${f.tamanho}">${f.tamanho}</span></div><div class="ficha-body"><div class="ficha-stats"><div class="ficha-stat"><small>Custo</small><div class="val red">R$ ${f.custoTotal.toFixed(2)}</div></div><div class="ficha-stat"><small>Venda</small><div class="val blue">R$ ${f.precoVenda.toFixed(2)}</div></div><div class="ficha-stat"><small>Lucro</small><div class="val green">R$ ${f.lucro.toFixed(2)}</div></div></div><div class="ficha-details">Ing: R$${(f.custoIng || 0).toFixed(2)} | Massa: R$${f.custoMassa.toFixed(2)} | Fixo: R$${f.custoFixo.toFixed(2)} | CMV: ${f.cmv.toFixed(1)}%</div><div class="ficha-actions"><button class="btn btn-warning btn-sm" onclick="editarFicha('${f.id}')">✏️</button><button class="btn btn-purple btn-sm" onclick="duplicarFicha('${f.id}')">📋</button><button class="btn btn-danger btn-sm" onclick="excluirFicha('${f.id}')">🗑️</button></div></div></div>`
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
    if (dashCF) dashCF.textContent = 'R$ ' + calcularCustoFixoPorPizza().toFixed(2);
    if (dashMassaM) dashMassaM.textContent = 'R$ ' + getCustoMassa('M').toFixed(2);
    if (dashMassaG) dashMassaG.textContent = 'R$ ' + getCustoMassa('G').toFixed(2);

    const fatCat = DB.fichas.reduce((acc, f) => acc + (f.precoVenda || 0), 0);
    const dashFatElem = document.getElementById('dashFat');
    if (dashFatElem) dashFatElem.textContent = 'R$ ' + fatCat.toFixed(2);

    let maiorMargemTxt = '-';
    if (DB.fichas.length > 0) {
        const topMargem = [...DB.fichas].sort((a, b) => {
            const margemA = a.precoVenda > 0 ? (a.lucro / a.precoVenda) * 100 : 0;
            const margemB = b.precoVenda > 0 ? (b.lucro / b.precoVenda) * 100 : 0;
            return margemB - margemA;
        });
        if (topMargem[0] && topMargem[0].precoVenda > 0) {
            maiorMargemTxt = topMargem[0].nome + ' (' + ((topMargem[0].lucro / topMargem[0].precoVenda) * 100).toFixed(1) + '%)';
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
                    `<tr><td><strong>${f.nome}</strong><br><small style="color:#777">Custo: R$ ${f.custoTotal.toFixed(2)}</small></td><td>R$ ${f.precoVenda.toFixed(2)}</td><td style="color:var(--success);font-weight:bold">R$ ${f.lucro.toFixed(2)}</td></tr>`
            )
            .join('')}</tbody></table>`;
        const htmlCards = `<div class="top5-mobile"><div class="top5-list">${top
            .map(
                (f) =>
                    `<div class="top5-mobile-card"><div class="t-title">${f.nome}</div><div class="t-row"><span>Custo: R$ ${f.custoTotal.toFixed(2)}</span></div><div class="t-row"><span>$$ Venda: R$ ${f.precoVenda.toFixed(2)}</span></div><div class="t-profit">💰 Lucro: R$ ${f.lucro.toFixed(2)}</div></div>`
            )
            .join('')}</div></div>`;

        topLista.innerHTML = htmlTable + htmlCards;
    } else {
        topLista.innerHTML = '<div class="empty">Cadastre fichas</div>';
    }

    renderRankingProdutosProntos();
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
            `<tr><td><strong>${p.nome}</strong><br><small style="color:#777">Custo: R$ ${p.precoCusto.toFixed(2)} | Venda: R$ ${p.precoVenda.toFixed(2)}</small></td><td><span class="badge badge-info">${p.icon} ${p.categoria}</span></td><td style="color:${p.lucro >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:bold">R$ ${p.lucro.toFixed(2)}</td><td style="font-weight:bold">${p.margem.toFixed(1)}%</td></tr>`
        ).join('')}</tbody></table>`;

    const htmlCards = `<div class="top5-mobile"><div class="top5-list">${ranking
        .map(p =>
            `<div class="top5-mobile-card" style="border-left-color:#00897b"><div class="t-title">${p.icon} ${p.nome}</div><div class="t-row"><span style="color:#777">${p.categoria}</span></div><div class="t-row"><span>Custo: R$ ${p.precoCusto.toFixed(2)}</span><span>Venda: R$ ${p.precoVenda.toFixed(2)}</span></div><div class="t-profit" style="color:${p.lucro >= 0 ? 'var(--success)' : 'var(--danger)'}">💰 Lucro: R$ ${p.lucro.toFixed(2)} | Margem: ${p.margem.toFixed(1)}%</div></div>`
        ).join('')}</div></div>`;

    container.innerHTML = htmlTable + htmlCards;
}

// ===== PRECIFICAR =====
function loadFichasSelect() {
    const select = document.getElementById('calcFicha');
    if (!select) return;

    select.innerHTML = '<option value="">-- Selecione --</option>' + DB.fichas.map((f) => `<option value="${f.id}">${f.nome} (${f.tamanho})</option>`).join('');
}

function calcPorCMV() {
    const custo = parseFloat(document.getElementById('calcCusto').value) || 0;
    const cmv = parseFloat(document.getElementById('calcCMV').value) || 30;
    document.getElementById('calcCMVVal').textContent = cmv + '%';
    if (custo > 0) {
        const preco = custo / (cmv / 100);
        document.getElementById('calcPreco').textContent = 'R$ ' + preco.toFixed(2);
        document.getElementById('calcLucro').textContent = 'Lucro: R$ ' + (preco - custo).toFixed(2);
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
    document.getElementById('cfIng').textContent = 'R$ ' + (f.custoIng || 0).toFixed(2);
    document.getElementById('cfMassaVal').textContent = 'R$ ' + custoMassa.toFixed(2);
    document.getElementById('cfFixo').textContent = 'R$ ' + custoFixo.toFixed(2);
    document.getElementById('cfTot').textContent = 'R$ ' + custoTotal.toFixed(2);
    document.getElementById('cfP35').textContent = 'R$ ' + (custoTotal / 0.35).toFixed(2);
    document.getElementById('cfP30').textContent = 'R$ ' + (custoTotal / 0.3).toFixed(2);
    document.getElementById('cfP25').textContent = 'R$ ' + (custoTotal / 0.25).toFixed(2);
}

// ===== MEIO A MEIO =====
function loadFichasSelectMeioAMeio() {
    const selA = document.getElementById('maMSaborA');
    const selB = document.getElementById('maMSaborB');
    if (!selA || !selB) return;

    const options = '<option value="">-- Selecione --</option>' +
        DB.fichas.map(f => `<option value="${f.id}">${f.nome} (${f.tamanho}) - R$ ${f.precoVenda.toFixed(2)}</option>`).join('');
    
    const valA = selA.value;
    const valB = selB.value;
    selA.innerHTML = options;
    selB.innerHTML = options;
    selA.value = valA;
    selB.value = valB;
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
    if (!fichaA || !fichaB) return;

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

    // Lucro Real
    const lucroReal = precoVenda - custoTotalProducao;

    // CMV e Margem
    const cmv = precoVenda > 0 ? (custoTotalProducao / precoVenda) * 100 : 0;
    const margem = precoVenda > 0 ? (lucroReal / precoVenda) * 100 : 0;

    // Identificar qual é o mais caro
    const maisCaroNome = fichaA.precoVenda >= fichaB.precoVenda ? fichaA.nome : fichaB.nome;

    resDiv.style.display = 'block';
    resDiv.innerHTML = `
        <div class="alert alert-info" style="margin-bottom:15px">
            🍕 <strong>Meio a Meio:</strong> ${fichaA.nome} + ${fichaB.nome}<br>
            <small>Preço cobrado pelo sabor mais caro: <strong>${maisCaroNome}</strong></small>
        </div>
        <table style="width:100%;margin:15px 0;font-size:0.9em">
            <tr style="background:#f8f9fa"><td colspan="3" style="padding:8px;font-weight:bold">📊 Decomposição do Custo</td></tr>
            <tr>
                <td style="padding:6px">½ ${fichaA.nome} (ingredientes):</td>
                <td style="text-align:right;padding:6px;color:#666">R$ ${(fichaA.custoIng || 0).toFixed(2)} ÷ 2</td>
                <td style="text-align:right;padding:6px;font-weight:bold">R$ ${custoIngA.toFixed(2)}</td>
            </tr>
            <tr>
                <td style="padding:6px">½ ${fichaB.nome} (ingredientes):</td>
                <td style="text-align:right;padding:6px;color:#666">R$ ${(fichaB.custoIng || 0).toFixed(2)} ÷ 2</td>
                <td style="text-align:right;padding:6px;font-weight:bold">R$ ${custoIngB.toFixed(2)}</td>
            </tr>
            <tr style="border-top:1px dashed #ccc">
                <td style="padding:6px">Custo Ingredientes (Meio a Meio):</td>
                <td></td>
                <td style="text-align:right;padding:6px;font-weight:bold;color:var(--danger)">R$ ${custoIngMeioAMeio.toFixed(2)}</td>
            </tr>
            <tr><td style="padding:6px">Massa:</td><td></td><td style="text-align:right;padding:6px">R$ ${custoMassa.toFixed(2)}</td></tr>
            <tr><td style="padding:6px">Custo Fixo:</td><td></td><td style="text-align:right;padding:6px">R$ ${custoFixo.toFixed(2)}</td></tr>
            <tr style="font-weight:bold;border-top:2px solid #333;background:#fff3e0">
                <td style="padding:8px">CUSTO TOTAL PRODUÇÃO:</td>
                <td></td>
                <td style="text-align:right;padding:8px;color:var(--danger);font-size:1.1em">R$ ${custoTotalProducao.toFixed(2)}</td>
            </tr>
        </table>
        <div class="resumo-box" style="margin-top:15px">
            <div class="resumo-grid" style="grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))">
                <div class="resumo-item"><small>💰 Preço Venda</small><div class="val blue" style="font-size:1.3em">R$ ${precoVenda.toFixed(2)}</div></div>
                <div class="resumo-item"><small>📦 Custo Total</small><div class="val red">R$ ${custoTotalProducao.toFixed(2)}</div></div>
                <div class="resumo-item"><small>🎯 Lucro Real</small><div class="val ${lucroReal >= 0 ? 'green' : 'red'}" style="font-size:1.3em">R$ ${lucroReal.toFixed(2)}</div></div>
                <div class="resumo-item"><small>📊 CMV</small><div class="val ${cmv <= 30 ? 'green' : cmv <= 35 ? 'yellow' : 'red'}">${cmv.toFixed(1)}%</div></div>
                <div class="resumo-item"><small>📈 Margem</small><div class="val ${margem >= 50 ? 'green' : margem >= 30 ? 'yellow' : 'red'}">${margem.toFixed(1)}%</div></div>
            </div>
        </div>
        <div class="alert ${lucroReal >= 0 ? 'alert-success' : 'alert-warning'}" style="margin-top:15px">
            ${lucroReal >= 0 
                ? '✅ <strong>Meio a Meio viável!</strong> Lucro de R$ ' + lucroReal.toFixed(2) + ' com margem de ' + margem.toFixed(1) + '%.'
                : '⚠️ <strong>Atenção!</strong> Esta combinação gera prejuízo de R$ ' + Math.abs(lucroReal).toFixed(2) + '. Revise os preços.'
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
        prev.innerHTML = '💡 Lucro: <strong>R$ ' + lucro.toFixed(2) + '</strong> | Margem: <strong>' + margem.toFixed(1) + '%</strong>';
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
            <td><strong>${p.nome}</strong></td>
            <td><span class="badge badge-info">${catIcons[p.categoria] || '📦'} ${p.categoria}</span></td>
            <td>R$ ${p.precoCusto.toFixed(2)}</td>
            <td>R$ ${p.precoVenda.toFixed(2)}</td>
            <td><strong style="color:${lucro >= 0 ? 'var(--success)' : 'var(--danger)'}">R$ ${lucro.toFixed(2)}</strong><br><small>${margem.toFixed(1)}%</small></td>
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
        adicionais.map(p => `<option value="${p.id}">${p.nome} - Venda: R$ ${p.precoVenda.toFixed(2)}</option>`).join('');
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
            return `<option value="${f.id}">${f.nome} (${f.tamanho}) - Venda: R$ ${f.precoVenda.toFixed(2)}</option>`;
        }).join('');
    selPizza.value = valPizza;

    // Bebida select (dos produtos prontos, categoria Bebida + Cerveja)
    const bebidas = DB.produtosProntos.filter(p => p.categoria === 'Bebida' || p.categoria === 'Cerveja');
    const valBebida = selBebida.value;
    selBebida.innerHTML = '<option value="">-- Selecione a Bebida --</option>' +
        bebidas.map(p => `<option value="${p.id}">${p.nome} - Venda: R$ ${p.precoVenda.toFixed(2)}</option>`).join('');
    selBebida.value = valBebida;

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

    const lucroReal = precoFinal - custoTotalCombo;
    const margem = precoFinal > 0 ? (lucroReal / precoFinal) * 100 : 0;
    const cmv = precoFinal > 0 ? (custoTotalCombo / precoFinal) * 100 : 0;

    // Gerar linhas de adicionais para as tabelas
    const adicionaisCustoHTML = adicionaisSelecionados.map(a => {
        const icon = a.categoria === 'Doce' ? '🍫' : '➕';
        return `<tr>
            <td style="padding:6px">${icon} ${a.nome} (custo compra):</td>
            <td></td>
            <td style="text-align:right;padding:6px;font-weight:bold">R$ ${(a.precoCusto || 0).toFixed(2)}</td>
        </tr>`;
    }).join('');

    const adicionaisVendaHTML = adicionaisSelecionados.map(a => {
        const icon = a.categoria === 'Doce' ? '🍫' : '➕';
        return `<tr><td style="padding:6px">${icon} ${a.nome}:</td><td style="text-align:right;padding:6px">R$ ${(a.precoVenda || 0).toFixed(2)}</td></tr>`;
    }).join('');

    const nomesAdicionais = adicionaisSelecionados.map(a => a.nome).join(' + ');
    const comboDescricao = pizza.nome + ' + ' + bebida.nome + (nomesAdicionais ? ' + ' + nomesAdicionais : '');

    resDiv.style.display = 'block';
    resDiv.innerHTML = `
        <div class="alert alert-info" style="margin-bottom:15px">
            🎯 <strong>Combo:</strong> ${comboDescricao}
        </div>
        <table style="width:100%;margin:10px 0;font-size:0.9em">
            <tr style="background:#f8f9fa"><td colspan="3" style="padding:8px;font-weight:bold">📊 Decomposição de Custos</td></tr>
            <tr>
                <td style="padding:6px">🍕 ${pizza.nome} (custo produção):</td>
                <td></td>
                <td style="text-align:right;padding:6px;font-weight:bold">R$ ${custoPizza.toFixed(2)}</td>
            </tr>
            <tr>
                <td style="padding:6px">🥤 ${bebida.nome} (custo compra):</td>
                <td></td>
                <td style="text-align:right;padding:6px;font-weight:bold">R$ ${custoBebida.toFixed(2)}</td>
            </tr>
            ${adicionaisCustoHTML}
            <tr style="font-weight:bold;border-top:2px solid #333;background:#fff3e0">
                <td style="padding:8px">CUSTO TOTAL DO COMBO:</td>
                <td></td>
                <td style="text-align:right;padding:8px;color:var(--danger);font-size:1.1em">R$ ${custoTotalCombo.toFixed(2)}</td>
            </tr>
        </table>
        <table style="width:100%;margin:10px 0;font-size:0.9em">
            <tr style="background:#e8f5e9"><td colspan="2" style="padding:8px;font-weight:bold">💰 Preços de Venda Individuais</td></tr>
            <tr><td style="padding:6px">🍕 ${pizza.nome}:</td><td style="text-align:right;padding:6px">R$ ${vendaPizza.toFixed(2)}</td></tr>
            <tr><td style="padding:6px">🥤 ${bebida.nome}:</td><td style="text-align:right;padding:6px">R$ ${vendaBebida.toFixed(2)}</td></tr>
            ${adicionaisVendaHTML}
            <tr style="border-top:1px solid #ccc"><td style="padding:6px;font-weight:bold">Soma Individual:</td><td style="text-align:right;padding:6px;font-weight:bold">R$ ${somaVendasIndividuais.toFixed(2)}</td></tr>
            ${precoPromo > 0 ? `<tr style="background:#fff8e1"><td style="padding:6px;font-weight:bold;color:#e65100">🏷️ Desconto Promocional:</td><td style="text-align:right;padding:6px;font-weight:bold;color:#e65100">- R$ ${desconto.toFixed(2)} (${descontoPerc.toFixed(1)}%)</td></tr>` : ''}
        </table>
        <div class="resumo-box" style="margin-top:15px">
            <div class="resumo-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr))">
                <div class="resumo-item"><small>💰 Preço Combo</small><div class="val blue" style="font-size:1.3em">R$ ${precoFinal.toFixed(2)}</div></div>
                <div class="resumo-item"><small>📦 Custo Total</small><div class="val red">R$ ${custoTotalCombo.toFixed(2)}</div></div>
                <div class="resumo-item"><small>🎯 Lucro Real</small><div class="val ${lucroReal >= 0 ? 'green' : 'red'}" style="font-size:1.3em">R$ ${lucroReal.toFixed(2)}</div></div>
                <div class="resumo-item"><small>📈 Margem</small><div class="val ${margem >= 50 ? 'green' : margem >= 30 ? 'yellow' : 'red'}">${margem.toFixed(1)}%</div></div>
                <div class="resumo-item"><small>📊 CMV</small><div class="val ${cmv <= 30 ? 'green' : cmv <= 35 ? 'yellow' : 'red'}">${cmv.toFixed(1)}%</div></div>
            </div>
        </div>
        <div class="alert ${lucroReal >= 0 ? 'alert-success' : 'alert-warning'}" style="margin-top:15px">
            ${lucroReal >= 0
                ? '✅ <strong>Combo viável!</strong> Lucro de R$ ' + lucroReal.toFixed(2) + ' com margem de ' + margem.toFixed(1) + '%.'
                  + (precoPromo > 0 && desconto > 0 ? ' Desconto de ' + descontoPerc.toFixed(1) + '% sobre o preço individual.' : '')
                : '⚠️ <strong>Atenção!</strong> Este combo gera prejuízo de R$ ' + Math.abs(lucroReal).toFixed(2) + '. Aumente o preço promocional.'
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
            if (!confirm('Importar dados?')) {
                e.target.value = '';
                return;
            }

            const mapaInsumos = {};
            (d.insumos || []).forEach((i) => {
                const novoId = gerarId();
                mapaInsumos[i.id] = novoId;
                DB.insumos.push({ ...i, id: novoId });
            });

            (d.fichas || []).forEach((f) => {
                const ingredientes = (f.ingredientes || []).map((ing) => ({
                    ...ing,
                    insumoId: mapaInsumos[ing.insumoId] || ing.insumoId
                }));
                DB.fichas.push({ ...f, id: gerarId(), ingredientes });
            });

            if (d.custos) DB.custos = d.custos;
            if (d.massa) {
                DB.massa = {
                    ...d.massa,
                    ingredientes: (d.massa.ingredientes || []).map((ing) => ({
                        ...ing,
                        insumoId: mapaInsumos[ing.insumoId] || ing.insumoId
                    }))
                };
            }
            if (d.config) DB.config = d.config;
            if (d.produtosProntos && d.produtosProntos.length > 0) {
                d.produtosProntos.forEach(p => {
                    DB.produtosProntos.push({ ...p, id: gerarId() });
                });
            }

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

        document.getElementById('calcPreco').textContent = 'R$ ' + precoSugerido.toFixed(2);
        document.getElementById('calcLucro').textContent = 'Lucro Bruto: R$ ' + lucroBruto.toFixed(2);
        const llElem = document.getElementById('calcLucroReal');
        if (llElem) {
            llElem.textContent =
                'Lucro Líquido (Pós Imposto): R$ ' +
                lucroLiquido.toFixed(2) +
                ' (' +
                (precoSugerido > 0 ? (lucroLiquido / precoSugerido) * 100 : 0).toFixed(1) +
                '%)';
        }
    } else {
        document.getElementById('calcPreco').textContent = 'R$ 0,00';
        document.getElementById('calcLucro').textContent = 'Lucro Bruto: R$ 0,00';
        const elem = document.getElementById('calcLucroReal');
        if (elem) elem.textContent = 'Lucro Líquido (Pós Imposto): R$ 0,00 (-)';
    }
}
