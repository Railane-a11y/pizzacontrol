# Atualização — Modelo Básico/PRO vitalício

Este arquivo resume o que foi alterado no código e, principalmente, o que
**ainda precisa ser feito por você fora do código** (Firebase Console e
automação de pagamento). Depois de conferir tudo, pode apagar este arquivo.

## O que já foi implementado no código

1. **Acesso agora é vitalício, sem data de vencimento**
   - `verificarAssinatura()` (em `app.js`) não checa mais `dataVencimento`.
     Agora só confirma se existe um documento do usuário no Firestore com o
     campo `plano` preenchido (`"basico"` ou `"pro"`).

2. **Bloqueio por plano nas abas, não mais só em botões soltos**
   - Plano **Básico**: Dashboard, Insumos, Fichas, Criar Ficha, Configurações.
   - Plano **PRO**: tudo do Básico + Massa, Custos Fixos, Bebidas, Gerar Preço.
   - As abas do PRO aparecem no menu com um 🔒 para o plano Básico. Ao
     clicar, abre um alerta de upgrade e um link (não abre a página).
   - Backup (Exportar/Importar) continua exclusivo do PRO.

3. **Aviso dentro de "Criar Ficha"**
   - Como o Básico não configura Custo Fixo nem Massa, a ficha técnica dele
     mostraria "R$ 0,00" nesses campos. Foi adicionado um aviso explicando
     que esse cálculo não inclui custo fixo/massa reais, e que isso é
     liberado no PRO — em vez de parecer um bug do sistema.

4. **Tela de "acesso não encontrado"**
   - Antes falava em "assinatura expirada" e tinha um botão de renovação
     mensal fixo em R$ 49,90. Agora fala em "acesso não encontrado" (mais
     correto para produto vitalício) e aponta para a página de vendas.

5. **Regras de segurança do Firestore** (arquivo novo: `firestore.rules`)
   - Antes, qualquer usuário logado conseguia **escrever** no próprio
     documento (e no de outros) — ou seja, um cliente Básico podia, pelo
     console do navegador, mudar `plano` para `"pro"` e liberar acesso total
     de graça. A nova regra permite só leitura do próprio documento e
     bloqueia toda escrita pelo app.

## O que você AINDA precisa fazer (fora do código)

Estes passos não dá pra resolver só subindo os arquivos pro GitHub:

- [ ] **Publicar a regra do Firestore.** Copie o conteúdo de
      `firestore.rules` e cole em *Firebase Console → Firestore Database →
      Regras → Publicar* (ou rode `firebase deploy --only firestore:rules`
      se usar a CLI). **Isso é o mais importante — sem publicar, a brecha
      de segurança antiga continua valendo.**

- [ ] **Ajustar sua automação (Make/webhook) para gravar só `email` e
      `plano`** — sem mais `dataVencimento`. O valor de `plano` deve ser
      `"basico"` ou `"pro"` de acordo com qual produto a pessoa comprou no
      checkout.

- [ ] **Trocar o link de upgrade nos avisos do PRO.** No topo do
      `app.js`, existe a constante:
      ```js
      const LINK_UPGRADE_PRO = 'https://pizzacontrol.com.br';
      ```
      Troque pela URL de checkout do plano PRO quando você tiver uma.

- [ ] **Confirmar/testar o botão "Esqueci minha senha"** na tela de login
      (função `recuperarSenha()`), já que agora não existe mais fluxo de
      "renovação" — a recuperação de senha vira o principal canal de
      autoatendimento.

## Pontos que ficaram de fora desta rodada (para depois)

- O `admin.html` continua sendo só uma tela local (lê dados do próprio
  navegador, não uma lista real de clientes). Resolver isso exige um painel
  com Firebase Admin SDK ou Cloud Functions — é um projeto à parte.
- Os links de "Política de Privacidade" e "Termos de Uso" na landing page
  (`index.html`) ainda apontam para `#` (não abrem nada).
- Os dados operacionais (insumos, fichas, custos) continuam salvos só no
  `localStorage` do navegador, sem sincronização automática em nuvem.
