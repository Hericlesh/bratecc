// ═══════════════════════════════════════════════════════════
// BRATECC Connect AI - Serviço de Inteligência Artificial
// Powered by Google Gemini
// ═══════════════════════════════════════════════════════════

const prisma = require('../config/database');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ─── CHAMADA À API DO GEMINI ───
async function callGemini(prompt, systemInstruction = null) {
  try {
    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
      }
    };

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Erro na API Gemini:', error);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    }
    
    throw new Error('Resposta inválida do Gemini');
  } catch (error) {
    console.error('Erro ao chamar Gemini:', error);
    throw error;
  }
}

// ─── EXTRAIR JSON DA RESPOSTA ───
function extractJSON(text) {
  try {
    // Tentar extrair JSON de blocos de código
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    
    // Tentar parsear diretamente
    return JSON.parse(text);
  } catch (e) {
    // Tentar encontrar objeto JSON no texto
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (e2) {
        console.error('Erro ao extrair JSON:', e2);
      }
    }
    
    // Tentar encontrar array JSON
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (e2) {
        console.error('Erro ao extrair JSON array:', e2);
      }
    }
    
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 1. CLASSIFICAÇÃO INTELIGENTE DE EMPRESA
// ═══════════════════════════════════════════════════════════

async function classificarEmpresa(empresa) {
  const systemInstruction = `Você é um especialista em comércio internacional Brasil-Texas, 
classificação de empresas e códigos de produtos (NCM/USHTS). 
Analise empresas e retorne classificações estruturadas em JSON.
Sempre responda APENAS com JSON válido, sem texto adicional.`;

  const prompt = `
Analise esta empresa e gere uma classificação estruturada:

EMPRESA:
- Nome: ${empresa.nome}
- Setor: ${empresa.setor}
- Tipo: ${empresa.tipo}
- Cidade/Estado: ${empresa.cidade}, ${empresa.estado}
- Descrição: ${empresa.descricao || 'Não informada'}
- Necessidades: ${empresa.necessidades || 'Não informadas'}

Retorne um JSON com a seguinte estrutura:
{
  "segmento": {
    "cnae": "código CNAE mais provável",
    "naics": "código NAICS mais provável",
    "descricao": "descrição do segmento"
  },
  "produtos_oferecidos": ["lista de produtos/serviços que a empresa oferece"],
  "produtos_demandados": ["lista de produtos/serviços que a empresa precisa"],
  "palavras_chave": ["palavras-chave estratégicas para matching"],
  "codigos_produto": [
    {"ncm": "código NCM", "ushts": "código USHTS", "descricao": "produto"}
  ],
  "regiao_atuacao": ["regiões de atuação"],
  "porte_estimado": "micro|pequena|media|grande",
  "perfil_comercial": {
    "principal_atividade": "exportação|importação|ambos",
    "mercados_alvo": ["mercados"],
    "diferenciais": ["diferenciais competitivos"]
  },
  "potencial_score": 1-100
}`;

  try {
    const response = await callGemini(prompt, systemInstruction);
    const classificacao = extractJSON(response);
    
    if (!classificacao) {
      throw new Error('Não foi possível extrair classificação');
    }
    
    return classificacao;
  } catch (error) {
    console.error('Erro ao classificar empresa:', error);
    // Retornar classificação básica em caso de erro
    return {
      segmento: {
        cnae: 'N/A',
        naics: 'N/A',
        descricao: empresa.setor
      },
      produtos_oferecidos: [],
      produtos_demandados: [],
      palavras_chave: [empresa.setor.toLowerCase()],
      codigos_produto: [],
      regiao_atuacao: [empresa.estado],
      porte_estimado: 'media',
      perfil_comercial: {
        principal_atividade: empresa.tipo.toLowerCase(),
        mercados_alvo: ['Brasil', 'Texas'],
        diferenciais: []
      },
      potencial_score: 50
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 2. CLASSIFICAÇÃO INTELIGENTE DE ASSOCIADO
// ═══════════════════════════════════════════════════════════

async function classificarAssociado(associado) {
  const systemInstruction = `Você é um especialista em comércio internacional Brasil-Texas 
e serviços de apoio a exportação/importação. 
Analise prestadores de serviço e retorne classificações estruturadas em JSON.
Sempre responda APENAS com JSON válido, sem texto adicional.`;

  const prompt = `
Analise este associado/prestador de serviço e gere uma classificação estruturada:

ASSOCIADO:
- Nome: ${associado.nome}
- Segmento: ${associado.segmento}
- Serviços: ${associado.servicos || 'Não informados'}
- Categorias: ${(associado.categorias || []).join(', ')}
- Email: ${associado.email}

Retorne um JSON com a seguinte estrutura:
{
  "tipo_servico": {
    "categoria_principal": "categoria",
    "subcategorias": ["subcategorias"]
  },
  "servicos_oferecidos": [
    {"nome": "serviço", "descricao": "descrição", "especialidade": "área"}
  ],
  "setores_atendidos": ["setores que este associado pode atender"],
  "palavras_chave": ["palavras-chave para matching"],
  "tipos_empresa_ideal": ["EXPORTADOR", "IMPORTADOR", "AMBOS"],
  "capacidades": {
    "trade_finance": true/false,
    "logistica": true/false,
    "legal_compliance": true/false,
    "tecnologia": true/false,
    "consultoria": true/false
  },
  "regiao_atuacao": ["regiões"],
  "idiomas": ["idiomas de atendimento"],
  "diferenciais": ["diferenciais competitivos"],
  "perfil_score": 1-100
}`;

  try {
    const response = await callGemini(prompt, systemInstruction);
    const classificacao = extractJSON(response);
    
    if (!classificacao) {
      throw new Error('Não foi possível extrair classificação');
    }
    
    return classificacao;
  } catch (error) {
    console.error('Erro ao classificar associado:', error);
    return {
      tipo_servico: {
        categoria_principal: associado.segmento,
        subcategorias: associado.categorias || []
      },
      servicos_oferecidos: [],
      setores_atendidos: [],
      palavras_chave: (associado.categorias || []).map(c => c.toLowerCase()),
      tipos_empresa_ideal: ['EXPORTADOR', 'IMPORTADOR', 'AMBOS'],
      capacidades: {
        trade_finance: false,
        logistica: false,
        legal_compliance: false,
        tecnologia: false,
        consultoria: false
      },
      regiao_atuacao: ['Brasil', 'Texas'],
      idiomas: ['Português', 'English'],
      diferenciais: [],
      perfil_score: 50
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 3. CRUZAMENTO DE OPORTUNIDADES - MATCH INTELIGENTE
// ═══════════════════════════════════════════════════════════

async function gerarMatchInteligente(empresa, associados, evento = null) {
  const systemInstruction = `Você é um especialista em matchmaking B2B para comércio internacional Brasil-Texas.
Sua função é analisar empresas e associados e identificar as melhores oportunidades de negócio.
Considere: aderência de produto, similaridade de segmento, probabilidade de negócio e contexto.
Sempre responda APENAS com JSON válido, sem texto adicional.`;

  const associadosInfo = associados.map(a => ({
    id: a.id,
    nome: a.nome,
    segmento: a.segmento,
    servicos: a.servicos,
    categorias: a.categorias
  }));

  const prompt = `
Analise esta empresa e os associados disponíveis para identificar os melhores matches:

EMPRESA:
- ID: ${empresa.id}
- Nome: ${empresa.nome}
- Setor: ${empresa.setor}
- Tipo: ${empresa.tipo}
- Cidade/Estado: ${empresa.cidade}, ${empresa.estado}
- Descrição: ${empresa.descricao || 'N/A'}
- Necessidades: ${empresa.necessidades || 'N/A'}

ASSOCIADOS DISPONÍVEIS:
${JSON.stringify(associadosInfo, null, 2)}

${evento ? `
CONTEXTO DO EVENTO:
- Nome: ${evento.nome}
- Local: ${evento.local}
- Categorias: ${(evento.categorias || []).join(', ')}
` : ''}

Para cada associado que faz sentido para esta empresa, retorne um JSON com array de matches:
{
  "matches": [
    {
      "associado_id": ID_DO_ASSOCIADO,
      "score": 0-100,
      "prioridade": "alta|media|baixa",
      "razoes_match": ["razão 1", "razão 2"],
      "servico_relevante": "qual serviço do associado é mais relevante",
      "oportunidade": "descrição da oportunidade de negócio",
      "acao_recomendada": "próximo passo sugerido",
      "analise": {
        "aderencia_produto": 0-100,
        "similaridade_segmento": 0-100,
        "probabilidade_negocio": 0-100,
        "contexto_bonus": 0-20
      }
    }
  ],
  "insights": {
    "perfil_empresa": "resumo do perfil da empresa",
    "necessidades_identificadas": ["necessidade 1", "necessidade 2"],
    "gaps": ["serviços que a empresa precisa mas nenhum associado oferece"]
  }
}

Para CADA associado da lista, retorne UM match no array. NÃO filtre por score
mínimo — todos os pares precisam ter score (mesmo baixo). Se o associado tem
pouca aderência, retorne com score baixo (10, 20, 30...). NUNCA omita um
associado da resposta.

Ordene por score decrescente. Limite máximo: 30 matches.`;

  try {
    const response = await callGemini(prompt, systemInstruction);
    const resultado = extractJSON(response);
    
    if (!resultado || !resultado.matches) {
      throw new Error('Não foi possível extrair matches');
    }
    
    return resultado;
  } catch (error) {
    console.error('Erro ao gerar matches inteligentes:', error);
    return { matches: [], insights: null };
  }
}

// ═══════════════════════════════════════════════════════════
// 4. MATCH B2B ENTRE ASSOCIADOS
// ═══════════════════════════════════════════════════════════

async function gerarMatchB2B(associados) {
  const systemInstruction = `Você é um especialista em identificar sinergias entre prestadores de serviço 
no ecossistema de comércio internacional Brasil-Texas.
Identifique oportunidades de parceria e colaboração entre associados.
Sempre responda APENAS com JSON válido, sem texto adicional.`;

  const associadosInfo = associados.map(a => ({
    id: a.id,
    nome: a.nome,
    segmento: a.segmento,
    servicos: a.servicos,
    categorias: a.categorias
  }));

  const prompt = `
Analise estes associados e identifique oportunidades de sinergia B2B:

ASSOCIADOS:
${JSON.stringify(associadosInfo, null, 2)}

Identifique pares de associados que podem:
1. Oferecer soluções complementares juntos
2. Fazer cross-selling de serviços
3. Criar pacotes integrados para empresas
4. Colaborar em projetos conjuntos

Retorne um JSON:
{
  "sinergias": [
    {
      "associado_origem_id": ID,
      "associado_destino_id": ID,
      "score": 0-100,
      "tipo_sinergia": "complementar|cross-sell|pacote|projeto",
      "descricao": "descrição da oportunidade de sinergia",
      "servico_origem": "serviço do primeiro associado",
      "servico_destino": "serviço do segundo associado",
      "beneficio_cliente": "como o cliente se beneficia",
      "acao_recomendada": "próximo passo"
    }
  ],
  "clusters": [
    {
      "nome": "nome do cluster",
      "associados_ids": [IDs],
      "proposta_valor": "proposta de valor do cluster"
    }
  ]
}

Para CADA par de associados, retorne UMA sinergia. NÃO filtre por score
mínimo — todos os pares precisam ter score (mesmo baixo). Se a sinergia é
fraca, retorne com score baixo. NUNCA omita um par da resposta.`;

  try {
    const response = await callGemini(prompt, systemInstruction);
    const resultado = extractJSON(response);
    
    if (!resultado || !resultado.sinergias) {
      throw new Error('Não foi possível extrair sinergias');
    }
    
    return resultado;
  } catch (error) {
    console.error('Erro ao gerar matches B2B:', error);
    return { sinergias: [], clusters: [] };
  }
}

// ═══════════════════════════════════════════════════════════
// 5. ANÁLISE DE EVENTO E SUGESTÃO DE MATCHES
// ═══════════════════════════════════════════════════════════

async function analisarEvento(evento, participantes, associados) {
  const systemInstruction = `Você é um especialista em eventos de negócios internacionais Brasil-Texas.
Analise eventos e sugira os melhores matches entre participantes e associados.
Sempre responda APENAS com JSON válido, sem texto adicional.`;

  const prompt = `
Analise este evento e sugira os melhores matches:

EVENTO:
- Nome: ${evento.nome}
- Local: ${evento.local}
- Data: ${evento.data}
- Descrição: ${evento.descricao || 'N/A'}
- Categorias: ${(evento.categorias || []).join(', ')}

EMPRESAS PARTICIPANTES:
${JSON.stringify(participantes.map(p => ({
  id: p.id,
  nome: p.nome,
  setor: p.setor,
  tipo: p.tipo,
  necessidades: p.necessidades
})), null, 2)}

ASSOCIADOS DO EVENTO:
${JSON.stringify(associados.map(a => ({
  id: a.id,
  nome: a.nome,
  segmento: a.segmento,
  servicos: a.servicos
})), null, 2)}

Retorne um JSON com:
{
  "analise_evento": {
    "perfil": "descrição do perfil do evento",
    "oportunidades_principais": ["oportunidade 1", "oportunidade 2"],
    "setores_predominantes": ["setor 1", "setor 2"]
  },
  "matches_sugeridos": [
    {
      "empresa_id": ID,
      "associado_id": ID,
      "score": 0-100,
      "prioridade": "alta|media|baixa",
      "contexto_evento": "como o evento potencializa este match",
      "sugestao_abordagem": "como fazer a aproximação durante o evento"
    }
  ],
  "agenda_recomendada": [
    {
      "horario": "sugestão de horário",
      "atividade": "tipo de atividade",
      "participantes": ["nomes ou IDs"],
      "objetivo": "objetivo da interação"
    }
  ]
}`;

  try {
    const response = await callGemini(prompt, systemInstruction);
    const resultado = extractJSON(response);
    
    if (!resultado) {
      throw new Error('Não foi possível analisar evento');
    }
    
    return resultado;
  } catch (error) {
    console.error('Erro ao analisar evento:', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 6. DEFINIR PRIORIDADE DO MATCH
// ═══════════════════════════════════════════════════════════

function calcularPrioridade(score, analise = null) {
  // Score base
  let prioridadeScore = score;
  
  // Ajustes baseados na análise detalhada
  if (analise) {
    const { aderencia_produto, similaridade_segmento, probabilidade_negocio, contexto_bonus } = analise;
    
    // Peso maior para probabilidade de negócio
    prioridadeScore = (
      (aderencia_produto || 0) * 0.25 +
      (similaridade_segmento || 0) * 0.20 +
      (probabilidade_negocio || 0) * 0.40 +
      (contexto_bonus || 0) * 0.15 +
      score * 0.10
    );
  }
  
  // Classificação de prioridade
  if (prioridadeScore >= 80) {
    return {
      nivel: 'alta',
      emoji: '🔥',
      acao: 'Abordagem imediata',
      descricao: 'Alta probabilidade de conversão. Priorizar contato.'
    };
  } else if (prioridadeScore >= 60) {
    return {
      nivel: 'media',
      emoji: '⚡',
      acao: 'Abordagem sequencial',
      descricao: 'Boa oportunidade. Incluir na sequência de contatos.'
    };
  } else {
    return {
      nivel: 'baixa',
      emoji: '❄️',
      acao: 'Nutrição futura',
      descricao: 'Potencial futuro. Manter no radar e nutrir relacionamento.'
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 7. GERAR RESUMO EXECUTIVO
// ═══════════════════════════════════════════════════════════

async function gerarResumoExecutivo(dados) {
  const systemInstruction = `Você é um consultor executivo especializado em comércio Brasil-Texas.
Gere resumos executivos claros e acionáveis.
Use linguagem profissional mas acessível.`;

  const prompt = `
Gere um resumo executivo baseado nestes dados:

${JSON.stringify(dados, null, 2)}

O resumo deve conter:
1. Visão geral da situação
2. Principais oportunidades identificadas
3. Recomendações prioritárias (top 3)
4. Próximos passos sugeridos

Formato: texto corrido, máximo 500 palavras, em português brasileiro.`;

  try {
    const response = await callGemini(prompt, systemInstruction);
    return response;
  } catch (error) {
    console.error('Erro ao gerar resumo:', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  callGemini,
  classificarEmpresa,
  classificarAssociado,
  gerarMatchInteligente,
  gerarMatchB2B,
  analisarEvento,
  calcularPrioridade,
  gerarResumoExecutivo
};
