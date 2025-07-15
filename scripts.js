// Configuração das APIs
const API_CONFIG = {
    ALPHA_VANTAGE: '2Z81R8J8Y7PIKH9D',
    GNEWS: 'd334e118c7271cba9ac78d7f8597b326',
    BRAPI: 'tycLXQfebi9sVszP6bfbt8' // Adicione sua chave Brapi
};

// Variáveis globais
let graficoAcao = null;
let graficoInflacao = null;
let graficoJuros = null;
let ultimaRequisicaoGrafico = 0;

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    atualizarData();
    converterMoeda(); 
    buscarCotacao();
    carregarNoticias();
    carregarGraficosEconomicos();
    
    // Configura listeners
    document.getElementById('ticker-select').addEventListener('change', buscarCotacao);
    document.getElementById('moeda-origem').addEventListener('change', converterMoeda);
    document.getElementById('moeda-destino').addEventListener('change', converterMoeda);
    document.getElementById('valor').addEventListener('input', converterMoeda);
});

function atualizarData() {
    const dataAtual = new Date();
    document.getElementById('data-atualizacao').textContent = dataAtual.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 1. Conversor de Moedas
async function converterMoeda() {
    const valor = document.getElementById('valor').value;
    const de = document.getElementById('moeda-origem').value;
    const para = document.getElementById('moeda-destino').value;
    
    if (valor <= 0 || de === para) {
        document.getElementById('resultado').innerHTML = `
            <span class="text-muted">Insira um valor válido e selecione moedas diferentes</span>
        `;
        return;
    }

    try {
        const resposta = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${de}&to_currency=${para}&apikey=${API_CONFIG.ALPHA_VANTAGE}`);
        const dados = await resposta.json();
        
        if (dados['Realtime Currency Exchange Rate']) {
            const taxa = parseFloat(dados['Realtime Currency Exchange Rate']['5. Exchange Rate']);
            const resultado = (valor * taxa).toFixed(2);
            
            document.getElementById('resultado').innerHTML = `
                ${valor} ${de} = <span class="text-success">${resultado} ${para}</span>
                <br><small>Taxa: 1 ${de} = ${taxa.toFixed(6)} ${para}</small>
            `;
        } else {
            throw new Error('Dados não disponíveis');
        }
    } catch (erro) {
        console.error('Erro ao converter moeda:', erro);
        document.getElementById('resultado').innerHTML = `
            <span class="text-danger">Erro ao obter cotações. Tente novamente mais tarde.</span>
            <br><small>${erro.message || 'Limite de requisições pode ter sido atingido'}</small>
        `;
    }
}

// 2. Cotações de Ações
async function buscarCotacao() {
    const select = document.getElementById('ticker-select');
    const codigo = select.value;
    
    document.getElementById('info-acao').innerHTML = `
        <div class="text-center">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Carregando...</span>
            </div>
        </div>
    `;

    try {
        // Tenta Alpha Vantage primeiro
        const resposta = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${codigo}&apikey=${API_CONFIG.ALPHA_VANTAGE}`);
        const dados = await resposta.json();
        
        if (dados['Global Quote']) {
            const cotacao = dados['Global Quote'];
            const simbolo = cotacao['01. symbol'];
            const preco = parseFloat(cotacao['05. price']).toFixed(2);
            const variacao = parseFloat(cotacao['09. change']).toFixed(2);
            const percentual = parseFloat(cotacao['10. change percent'].replace('%','')).toFixed(2);
            
            exibirCotacao(simbolo, preco, variacao, percentual);
            buscarHistorico(simbolo);
        } else {
            // Fallback para Brapi se Alpha Vantage falhar
            await buscarComBrapi(codigo);
        }
    } catch (erro) {
        console.error('Erro ao buscar cotação:', erro);
        try {
            // Tenta Brapi como fallback
            await buscarComBrapi(codigo);
        } catch (erroBrapi) {
            console.error('Erro no Brapi:', erroBrapi);
            document.getElementById('info-acao').innerHTML = `
                <div class="alert alert-danger">
                    Não foi possível obter dados para ${codigo.replace('.SAO','')}.<br>
                    <small>${erro.message || 'API pode estar indisponível'}</small>
                </div>
            `;
        }
    }
}

async function buscarComBrapi(codigo) {
    // Remove .SAO para ações brasileiras
    const codigoBrapi = codigo.replace('.SAO', '');
    const resposta = await fetch(`https://brapi.dev/api/quote/${codigoBrapi}?token=${API_CONFIG.BRAPI}`);
    const dados = await resposta.json();
    
    if (dados.results && dados.results[0]) {
        const resultado = dados.results[0];
        const preco = resultado.regularMarketPrice.toFixed(2);
        const variacao = resultado.regularMarketChange.toFixed(2);
        const percentual = resultado.regularMarketChangePercent.toFixed(2);
        
        exibirCotacao(codigo, preco, variacao, percentual);
        
        if (resultado.historicalDataPrice) {
            criarGraficoAcao(
                resultado.historicalDataPrice.map(item => new Date(item.date * 1000)),
                resultado.historicalDataPrice.map(item => item.close),
                codigoBrapi
            );
        }
    } else {
        throw new Error('Dados não encontrados no Brapi');
    }
}

function exibirCotacao(simbolo, preco, variacao, percentual) {
    document.getElementById('info-acao').innerHTML = `
        <h3>${simbolo.replace('.SAO','')}</h3>
        <div class="d-flex align-items-center">
            <span class="fs-4 me-2 ${variacao >= 0 ? 'text-success' : 'text-danger'}">${preco}</span>
            <span class="badge ${variacao >= 0 ? 'bg-success' : 'bg-danger'}">
                ${variacao >= 0 ? '+' : ''}${variacao} (${percentual}%)
            </span>
        </div>
        <small class="text-muted">Atualizado: ${new Date().toLocaleTimeString('pt-BR')}</small>
    `;
}

async function buscarHistorico(simbolo) {
    const agora = Date.now();
    const container = document.getElementById('grafico-acao');
    
    // Verifica cache
    const cacheKey = `hist-${simbolo}-${new Date().toISOString().slice(0, 10)}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached && agora - ultimaRequisicaoGrafico < 300000) { // 5 minutos de cache
        const { datas, valores } = JSON.parse(cached);
        criarGraficoAcao(datas, valores, simbolo.replace('.SAO',''));
        return;
    }

    container.innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Carregando...</span>
            </div>
        </div>
    `;

    try {
        const resposta = await fetch(`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${simbolo}&apikey=${API_CONFIG.ALPHA_VANTAGE}&outputsize=compact`);
        const dados = await resposta.json();
        
        if (dados['Time Series (Daily)']) {
            const series = dados['Time Series (Daily)'];
            const datas = Object.keys(series).reverse().slice(0, 30);
            const valores = datas.map(data => parseFloat(series[data]['4. close']));
            
            // Salva no cache
            localStorage.setItem(cacheKey, JSON.stringify({
                datas: datas.map(data => new Date(data)),
                valores
            }));
            
            criarGraficoAcao(
                datas.map(data => new Date(data)),
                valores,
                simbolo.replace('.SAO','')
            );
        } else {
            throw new Error('Dados históricos não disponíveis');
        }
    } catch (erro) {
        console.error('Erro no histórico:', erro);
        // Tenta Brapi como fallback
        try {
            await buscarComBrapi(simbolo);
        } catch (erroBrapi) {
            console.error('Erro no Brapi:', erroBrapi);
            container.innerHTML = `
                <div class="alert alert-warning">
                    Dados históricos temporariamente indisponíveis
                </div>
            `;
        }
    }
}

function criarGraficoAcao(datas, valores, simbolo) {
    const ctx = document.getElementById('grafico-acao').getContext('2d');
    
    if (graficoAcao) {
        graficoAcao.destroy();
    }
    
    graficoAcao = new Chart(ctx, {
        type: 'line',
        data: {
            labels: datas,
            datasets: [{
                label: `${simbolo} - Últimos 30 dias`,
                data: valores,
                borderColor: 'rgba(75, 192, 192, 1)',
                backgroundColor: 'rgba(75, 192, 192, 0.1)',
                tension: 0.1,
                fill: true,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    titleFont: { size: 14 },
                    bodyFont: { size: 12 },
                    padding: 10
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        tooltipFormat: 'dd/MM/yyyy',
                        displayFormats: {
                            day: 'dd/MM'
                        }
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'nearest'
            }
        }
    });
}

// 3. Gráficos Econômicos
function carregarGraficosEconomicos() {
    // Gráfico de Inflação
    const ctxInflacao = document.getElementById('grafico-inflacao').getContext('2d');
    graficoInflacao = new Chart(ctxInflacao, {
        type: 'bar',
        data: {
            labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'],
            datasets: [{
                label: 'IPCA Mensal (%)',
                data: [0.53, 0.83, 0.71, 0.61, 0.47, 0.35],
                backgroundColor: 'rgba(255, 99, 132, 0.7)',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // Gráfico de Juros
    const ctxJuros = document.getElementById('grafico-juros').getContext('2d');
    graficoJuros = new Chart(ctxJuros, {
        type: 'line',
        data: {
            labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'],
            datasets: [{
                label: 'Taxa Selic (% a.a.)',
                data: [13.75, 13.75, 13.25, 12.75, 12.25, 11.75],
                borderColor: 'rgba(54, 162, 235, 1)',
                backgroundColor: 'rgba(54, 162, 235, 0.1)',
                tension: 0.3,
                fill: true,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

// 4. Notícias Econômicas
async function carregarNoticias() {
    const container = document.getElementById('feed-noticias');
    
    container.innerHTML = `
        <div class="col-12">
            <div class="skeleton-loader"></div>
            <div class="skeleton-loader"></div>
            <div class="skeleton-loader"></div>
        </div>
    `;

    try {
        const resposta = await fetch(`https://gnews.io/api/v4/top-headlines?category=business&lang=pt&country=br&max=6&apikey=${API_CONFIG.GNEWS}`);
        
        if (!resposta.ok) {
            throw new Error(`Erro HTTP: ${resposta.status}`);
        }
        
        const dados = await resposta.json();
        
        if (!dados.articles || dados.articles.length === 0) {
            throw new Error('Nenhuma notícia encontrada');
        }

        container.innerHTML = dados.articles.map(noticia => `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card h-100">
                    <img src="${noticia.image || 'https://via.placeholder.com/300x200?text=Sem+Imagem'}" 
                         class="card-img-top" 
                         alt="${noticia.title}" 
                         onerror="this.src='https://via.placeholder.com/300x200?text=Imagem+Não+Disponível'">
                    <div class="card-body">
                        <h5 class="card-title">${noticia.title}</h5>
                        <p class="card-text">${noticia.description || 'Clique para ler mais...'}</p>
                    </div>
                    <div class="card-footer bg-transparent">
                        <small class="text-muted">
                            ${new Date(noticia.publishedAt).toLocaleDateString('pt-BR')} • 
                            ${noticia.source.name}
                        </small>
                        <a href="${noticia.url}" target="_blank" class="btn btn-sm btn-outline-primary float-end">
                            Ler <i class="bi bi-arrow-right"></i>
                        </a>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (erro) {
        console.error('Erro ao carregar notícias:', erro);
        container.innerHTML = `
            <div class="col-12">
                <div class="alert alert-warning">
                    <div class="d-flex align-items-center">
                        <i class="bi bi-exclamation-triangle-fill me-3 fs-4"></i>
                        <div>
                            <h5 class="alert-heading mb-2">Não foi possível carregar as notícias</h5>
                            <p>${erro.message || 'Por favor, tente recarregar a página mais tarde.'}</p>
                            <button onclick="carregarNoticias()" class="btn btn-sm btn-warning">
                                <i class="bi bi-arrow-repeat"></i> Tentar novamente
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Limpar cache antigo periodicamente
function limparCacheAntigo() {
    const umaSemanaAtras = Date.now() - (7 * 24 * 60 * 60 * 1000);
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('hist-')) {
            const data = key.split('-')[2];
            if (new Date(data) < new Date(umaSemanaAtras)) {
                localStorage.removeItem(key);
            }
        }
    });
}

// Executa a cada hora
setInterval(limparCacheAntigo, 3600000);