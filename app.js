let mapa = null;
let marcador = null;
let dadosPrevisaoPorDia = []; // Lista agrupada por dia [ { data, horas: [...] } ]
let dadosAtuaisTempoReal = null; // Dados 'current' em tempo real
let abaAtual = 0;
let horaSelecionadaIndex = 0;
let altitudeAtual = 80; // 10, 80 ou 120 metros
let indiceKpAtual = null;

// Configuração de Cache Inteligente Local (15 minutos)
const CACHE_KEY_PREFIX = 'droneweather_cache_v3_';
const CACHE_TTL_MS = 15 * 60 * 1000;

function obterDoCache(lat, lon) {
    try {
        const chave = `${CACHE_KEY_PREFIX}${lat.toFixed(3)}_${lon.toFixed(3)}`;
        const bruto = localStorage.getItem(chave);
        if (!bruto) return null;
        const item = JSON.parse(bruto);
        if (Date.now() - item.timestamp < CACHE_TTL_MS) {
            return item.dados;
        }
    } catch (e) {}
    return null;
}

function salvarNoCache(lat, lon, dados) {
    try {
        const chave = `${CACHE_KEY_PREFIX}${lat.toFixed(3)}_${lon.toFixed(3)}`;
        localStorage.setItem(chave, JSON.stringify({
            timestamp: Date.now(),
            dados: dados
        }));
    } catch (e) {}
}

// Tabela WMO Weather interpretation codes
const WMO_CODES = {
    0: { desc: 'Céu limpo', icon: '☀️', chovendo: false },
    1: { desc: 'Quase limpo', icon: '🌤️', chovendo: false },
    2: { desc: 'Parcialmente nublado', icon: '⛅', chovendo: false },
    3: { desc: 'Encoberto', icon: '☁️', chovendo: false },
    45: { desc: 'Neblina', icon: '🌫️', chovendo: false },
    48: { desc: 'Nevoeiro', icon: '🌫️', chovendo: false },
    51: { desc: 'Garoa leve', icon: '🌦️', chovendo: true },
    53: { desc: 'Garoa', icon: '🌦️', chovendo: true },
    55: { desc: 'Garoa densa', icon: '🌧️', chovendo: true },
    61: { desc: 'Chuva fraca', icon: '🌧️', chovendo: true },
    63: { desc: 'Chuva', icon: '🌧️', chovendo: true },
    65: { desc: 'Chuva forte', icon: '🌧️', chovendo: true },
    71: { desc: 'Neve fraca', icon: '🌨️', chovendo: true },
    73: { desc: 'Neve', icon: '🌨️', chovendo: true },
    75: { desc: 'Neve forte', icon: '❄️', chovendo: true },
    80: { desc: 'Pancadas de chuva', icon: '🌦️', chovendo: true },
    81: { desc: 'Pancadas moderadas', icon: '🌧️', chovendo: true },
    82: { desc: 'Pancadas fortes', icon: '⛈️', chovendo: true },
    95: { desc: 'Tempestade com trovões', icon: '⛈️', chovendo: true },
    96: { desc: 'Tempestade c/ granizo', icon: '⛈️', chovendo: true },
    99: { desc: 'Tempestade severa', icon: '⛈️', chovendo: true }
};

// Funções helpers seguras para manipular o DOM
function definirTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.innerText = valor;
}

function definirClasse(id, classe) {
    const el = document.getElementById(id);
    if (el) el.className = classe;
}

function traduzirWmo(code) {
    return WMO_CODES[code] || { desc: 'Instável', icon: '⛅', chovendo: false };
}

function inicializarMapa(lat, lon) {
    if (typeof L === 'undefined') return;
    const elMapa = document.getElementById('mapa');
    if (!elMapa) return;

    const latitude = lat || -27.5954;
    const longitude = lon || -48.5480;
    if (!mapa) {
        mapa = L.map('mapa', { zoomControl: true }).setView([latitude, longitude], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapa);
        marcador = L.marker([latitude, longitude]).addTo(mapa);
    } else {
        mapa.setView([latitude, longitude], 14);
        marcador.setLatLng([latitude, longitude]);
    }
}

async function buscarIndiceKpSolar() {
    try {
        const resposta = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
        if (resposta.ok) {
            const dados = await resposta.json();
            if (Array.isArray(dados) && dados.length > 0) {
                const ultimo = dados[dados.length - 1];
                let kp = null;
                if (typeof ultimo === 'object' && ultimo.Kp !== undefined) {
                    kp = parseFloat(ultimo.Kp);
                } else if (Array.isArray(ultimo) && ultimo.length > 1) {
                    kp = parseFloat(ultimo[1]);
                }
                if (!isNaN(kp) && kp !== null) return kp;
            }
        }
    } catch (e) {
        console.warn('Erro ao consultar NOAA direto:', e);
    }
    return 1.3;
}

// Geocodificação reversa de alta disponibilidade com fallback
async function descobrirBairroExato(lat, lon) {
    // 1ª tentativa: Nominatim com header e timeout rápido
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const urlGeo = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
        const resposta = await fetch(urlGeo, { 
            headers: { 'Accept-Language': 'pt-BR' },
            signal: controller.signal 
        });
        clearTimeout(timeoutId);
        if (resposta.ok) {
            const resultado = await resposta.json();
            if (resultado && resultado.address) {
                const bairro = resultado.address.suburb || resultado.address.neighbourhood || resultado.address.village || resultado.address.commercial;
                const cidade = resultado.address.city || resultado.address.town || resultado.address.municipality;
                if (bairro && cidade) return `${bairro}, ${cidade}`;
                if (bairro) return bairro;
                if (cidade) return cidade;
            }
        }
    } catch (e) {}

    // 2ª tentativa: Open-Meteo Geocoding reverso como fallback
    try {
        const urlOM = `https://geocoding-api.open-meteo.com/v1/search?name=&latitude=${lat}&longitude=${lon}&count=1&language=pt&format=json`;
        const resOM = await fetch(urlOM).then(r => r.json());
        if (resOM && resOM.results && resOM.results.length > 0) {
            const r = resOM.results[0];
            return `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}`;
        }
    } catch (e) {}

    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

function agruparDadosOpenMeteo(resMeteo) {
    const hourly = resMeteo.hourly;
    const daily = resMeteo.daily || {};
    const grupos = {};
    const totalHoras = hourly.time.length;

    // Mapeamento diário para sol (sunrise / sunset)
    const mapaSolPorData = {};
    if (daily.time && daily.sunrise && daily.sunset) {
        for (let d = 0; d < daily.time.length; d++) {
            const dataIso = daily.time[d];
            const nascer = daily.sunrise[d] ? daily.sunrise[d].split('T')[1].slice(0, 5) : '--:--';
            const por = daily.sunset[d] ? daily.sunset[d].split('T')[1].slice(0, 5) : '--:--';
            mapaSolPorData[dataIso] = { nascer, por };
        }
    }

    for (let i = 0; i < totalHoras; i++) {
        const isoTime = hourly.time[i];
        const [dataStr, horaStr] = isoTime.split('T');

        if (!grupos[dataStr]) {
            grupos[dataStr] = [];
        }

        const visibMetros = (hourly.visibility && hourly.visibility[i] !== undefined && hourly.visibility[i] !== null) ? hourly.visibility[i] : 10000;
        const visibKm = Math.round(visibMetros / 1000);

        const precipMm = hourly.precipitation ? hourly.precipitation[i] : 0;
        const rainMm = hourly.rain ? hourly.rain[i] : 0;
        const showerMm = hourly.showers ? hourly.showers[i] : 0;
        const totalChuvaMm = Math.max(precipMm, rainMm + showerMm);

        const v10 = hourly.wind_speed_10m ? Math.round(hourly.wind_speed_10m[i] * 10) / 10 : 0;
        const v80 = hourly.wind_speed_80m ? Math.round(hourly.wind_speed_80m[i] * 10) / 10 : 0;
        const v120 = hourly.wind_speed_120m ? Math.round(hourly.wind_speed_120m[i] * 10) / 10 : 0;
        const r10 = hourly.wind_gusts_10m ? Math.round(hourly.wind_gusts_10m[i] * 10) / 10 : 0;

        const infoSol = mapaSolPorData[dataStr] || { nascer: '--:--', por: '--:--' };

        grupos[dataStr].push({
            dataStr: dataStr,
            horaCompleta: isoTime,
            hora: horaStr,
            temp: Math.round(hourly.temperature_2m[i]),
            umidade: hourly.relative_humidity_2m[i],
            probChuva: (hourly.precipitation_probability && hourly.precipitation_probability[i] !== null) ? hourly.precipitation_probability[i] : 0,
            chuvaMm: totalChuvaMm,
            nuvens: hourly.cloud_cover[i],
            visibilidade: visibKm,
            solNascer: infoSol.nascer,
            solPor: infoSol.por,
            vento10m: v10,
            vento80m: v80,
            vento120m: v120,
            rajada: r10,
            graus10m: hourly.wind_direction_10m[i],
            graus120m: hourly.wind_direction_120m[i],
            weatherCode: hourly.weather_code[i]
        });
    }

    const resultadoDias = Object.keys(grupos).slice(0, 5).map(data => {
        const infoSol = mapaSolPorData[data] || { nascer: '--:--', por: '--:--' };
        return {
            data: data,
            solNascer: infoSol.nascer,
            solPor: infoSol.por,
            horas: grupos[data]
        };
    });

    return resultadoDias;
}

function atualizarLabelsAbas(dias) {
    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    
    definirTexto('aba0', 'Hoje');
    if (dias.length > 1) {
        definirTexto('aba1', 'Amanhã');
    }

    for (let i = 2; i < 5; i++) {
        const elAba = document.getElementById('aba' + i);
        if (elAba) {
            if (dias[i]) {
                const partes = dias[i].data.split('-');
                const dataObj = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
                elAba.innerText = diasSemana[dataObj.getDay()];
                elAba.style.display = 'block';
            } else {
                elAba.style.display = 'none';
            }
        }
    }
}

function mudarAltitude(alt) {
    altitudeAtual = alt;
    const btn10 = document.getElementById('btnAlt10');
    const btn80 = document.getElementById('btnAlt80');
    const btn120 = document.getElementById('btnAlt120');

    if (btn10) btn10.classList.toggle('ativa', alt === 10);
    if (btn80) btn80.classList.toggle('ativa', alt === 80);
    if (btn120) btn120.classList.toggle('ativa', alt === 120);
    definirTexto('labelAltitudeVento', alt + 'm');

    renderizarCarrosselHoras();
    renderizarPainelHoraAtual();
}

function mudarAba(indice) {
    if (!dadosPrevisaoPorDia[indice]) return;
    abaAtual = indice;
    for (let i = 0; i < 5; i++) {
        const elAba = document.getElementById('aba' + i);
        if (elAba) elAba.classList.toggle('ativa', i === indice);
    }

    if (indice === 0) {
        const agora = new Date();
        const horaAtualNum = agora.getHours();
        const listaHoras = dadosPrevisaoPorDia[0].horas;
        
        let indiceMaisProximo = 0;
        let menorDiferenca = 999;
        listaHoras.forEach((h, idx) => {
            const horaH = parseInt(h.hora.split(':')[0], 10);
            const dif = Math.abs(horaH - horaAtualNum);
            if (dif < menorDiferenca) {
                menorDiferenca = dif;
                indiceMaisProximo = idx;
            }
        });
        horaSelecionadaIndex = indiceMaisProximo;
    } else {
        const listaHoras = dadosPrevisaoPorDia[indice].horas;
        const indiceMeioDia = listaHoras.findIndex(h => {
            const horaH = parseInt(h.hora.split(':')[0], 10);
            return horaH >= 12 && horaH <= 15;
        });
        horaSelecionadaIndex = indiceMeioDia >= 0 ? indiceMeioDia : Math.floor(listaHoras.length / 2);
    }

    renderizarCarrosselHoras();
    renderizarPainelHoraAtual();
}

function renderizarCarrosselHoras() {
    const container = document.getElementById('horasScroll');
    if (!container) return;
    container.innerHTML = '';
    const diaObj = dadosPrevisaoPorDia[abaAtual];
    if (!diaObj || !diaObj.horas) return;

    diaObj.horas.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'hora-card' + (index === horaSelecionadaIndex ? ' ativa' : '');
        
        let infoWmo = traduzirWmo(item.weatherCode);
        if (abaAtual === 0 && index === horaSelecionadaIndex && dadosAtuaisTempoReal) {
            infoWmo = traduzirWmo(dadosAtuaisTempoReal.weather_code);
        }

        const ventoEscolhido = altitudeAtual === 10 ? item.vento10m : (altitudeAtual === 80 ? item.vento80m : item.vento120m);
        const corVento = ventoEscolhido > 30 ? '#f75a68' : (ventoEscolhido > 18 ? '#ffc107' : '#00b37e');

        card.innerHTML = `
            <div class="hora-titulo">${item.hora}</div>
            <div class="hora-clima-icon">${infoWmo.icon}</div>
            <div class="hora-vento" style="color: ${corVento}">${Math.round(ventoEscolhido)} km/h</div>
        `;

        card.onclick = () => {
            horaSelecionadaIndex = index;
            document.querySelectorAll('.hora-card').forEach((el, idx) => {
                el.classList.toggle('ativa', idx === index);
            });
            renderizarPainelHoraAtual();
        };

        container.appendChild(card);
    });

    const ativaEl = container.children[horaSelecionadaIndex];
    if (ativaEl && typeof ativaEl.scrollIntoView === 'function') {
        ativaEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

function converterGrausParaDirecao(graus) {
    if (graus > 22.5 && graus <= 67.5) return '↙ NE';
    if (graus > 67.5 && graus <= 112.5) return '← L';
    if (graus > 112.5 && graus <= 157.5) return '↖ SE';
    if (graus > 157.5 && graus <= 202.5) return '↑ S';
    if (graus > 202.5 && graus <= 247.5) return '↗ SO';
    if (graus > 247.5 && graus <= 292.5) return '→ O';
    if (graus > 292.5 && graus <= 337.5) return '↘ NO';
    return '↓ N';
}

function renderizarPainelHoraAtual() {
    const diaObj = dadosPrevisaoPorDia[abaAtual];
    if (!diaObj || !diaObj.horas || !diaObj.horas[horaSelecionadaIndex]) return;

    const ponto = diaObj.horas[horaSelecionadaIndex];
    const isMomentoAtual = (abaAtual === 0 && horaSelecionadaIndex === obterIndiceHoraMaisProxima(dadosPrevisaoPorDia[0].horas));

    let weatherCode = ponto.weatherCode;
    let temp = ponto.temp;
    let umidade = ponto.umidade;
    let chuvaMm = ponto.chuvaMm;
    let probChuva = ponto.probChuva;
    let nuvens = ponto.nuvens;
    let vento10 = ponto.vento10m;
    let rajada = ponto.rajada;
    let graus = (altitudeAtual === 120 ? ponto.graus120m : ponto.graus10m);

    if (isMomentoAtual && dadosAtuaisTempoReal) {
        weatherCode = dadosAtuaisTempoReal.weather_code;
        temp = Math.round(dadosAtuaisTempoReal.temperature_2m);
        umidade = dadosAtuaisTempoReal.relative_humidity_2m;
        nuvens = dadosAtuaisTempoReal.cloud_cover;
        vento10 = Math.round(dadosAtuaisTempoReal.wind_speed_10m * 10) / 10;
        rajada = Math.round(dadosAtuaisTempoReal.wind_gusts_10m * 10) / 10;
        graus = dadosAtuaisTempoReal.wind_direction_10m;

        const precipReal = Math.max(
            dadosAtuaisTempoReal.precipitation || 0,
            (dadosAtuaisTempoReal.rain || 0) + (dadosAtuaisTempoReal.showers || 0)
        );
        if (precipReal > 0) {
            chuvaMm = precipReal;
        }
    }

    const infoWmo = traduzirWmo(weatherCode);
    const estaChovendoAtualmente = infoWmo.chovendo || chuvaMm > 0;

    let ventoVelocidade = ponto.vento80m;
    if (altitudeAtual === 10) {
        ventoVelocidade = vento10;
    } else if (altitudeAtual === 120) {
        ventoVelocidade = ponto.vento120m;
    }

    const ventoFormatado = ventoVelocidade.toFixed(1);
    const rajadaFormatada = rajada.toFixed(1);

    definirTexto('valorVento', `${ventoFormatado} km/h`);
    definirTexto('valorRajada', `${rajadaFormatada} km/h`);
    definirTexto('valorDirecao', converterGrausParaDirecao(graus));
    definirTexto('valorCondicao', `${infoWmo.icon} ${infoWmo.desc}`);

    const elChuvaMm = document.getElementById('valorChuvaMm');
    if (elChuvaMm) {
        elChuvaMm.innerText = estaChovendoAtualmente ? `${chuvaMm.toFixed(1)} mm/h` : '0 mm (Sem chuva)';
        elChuvaMm.className = 'valor-dados ' + (estaChovendoAtualmente ? 'perigo' : 'bom');
    }

    const elProbChuva = document.getElementById('valorChuva');
    if (elProbChuva) {
        elProbChuva.innerText = `${probChuva}%`;
        elProbChuva.className = 'valor-dados ' + (estaChovendoAtualmente || probChuva > 40 ? 'perigo' : (probChuva > 20 ? 'atencao' : 'bom'));
    }

    definirTexto('valorTemp', `${temp} °C`);
    definirTexto('valorUmidade', `${umidade} %`);
    definirTexto('valorNuvens', `${nuvens} %`);

    const nascerSol = ponto.solNascer || '--:--';
    const porSol = ponto.solPor || '--:--';
    definirTexto('valorSol', `${nascerSol} / ${porSol}`);

    const visibilidadeKm = ponto.visibilidade || 10;
    const elVisib = document.getElementById('valorVisibilidade');
    if (elVisib) {
        elVisib.innerText = `${visibilidadeKm} km`;
        elVisib.className = 'valor-dados ' + (visibilidadeKm < 3 ? 'perigo' : (visibilidadeKm < 6 ? 'atencao' : 'bom'));
    }

    const valorKp = (indiceKpAtual !== null) ? indiceKpAtual : 1.3;
    let labelKp = 'Seguro';
    let classeKp = 'bom';
    if (valorKp >= 5) {
        labelKp = '⚠️ Tormenta Solar';
        classeKp = 'perigo';
    } else if (valorKp >= 4) {
        labelKp = 'Atenção';
        classeKp = 'atencao';
    }

    const elKp = document.getElementById('valorKp');
    if (elKp) {
        elKp.innerText = `KP ${valorKp.toFixed(1)} (${labelKp})`;
        elKp.className = 'valor-dados ' + classeKp;
    }

    definirClasse('valorVento', 'valor-dados ' + (ventoVelocidade > 30 ? 'perigo' : (ventoVelocidade > 18 ? 'atencao' : 'bom')));
    definirClasse('valorRajada', 'valor-dados ' + (rajada > 38 ? 'perigo' : (rajada > 25 ? 'atencao' : 'bom')));

    const statusBox = document.getElementById('statusVoo');
    const statusTexto = document.getElementById('textoStatus');

    if (statusBox && statusTexto) {
        if (estaChovendoAtualmente) {
            statusBox.style.backgroundColor = '#dc3545';
            statusBox.style.color = '#fff';
            statusTexto.innerText = `🛑 Voo Desfavorável: ${infoWmo.desc}`;
        } else if (ventoVelocidade > 30 || rajada > 38) {
            statusBox.style.backgroundColor = '#dc3545';
            statusBox.style.color = '#fff';
            statusTexto.innerText = `🛑 Vento forte (${ventoFormatado} km/h) a ${altitudeAtual}m`;
        } else if (visibilidadeKm < 3) {
            statusBox.style.backgroundColor = '#dc3545';
            statusBox.style.color = '#fff';
            statusTexto.innerText = '🛑 Baixa Visibilidade (< 3km) para VLOS';
        } else if (valorKp >= 5) {
            statusBox.style.backgroundColor = '#dc3545';
            statusBox.style.color = '#fff';
            statusTexto.innerText = '🛑 Tempestade Geomagnética (Risco GPS)';
        } else if (ventoVelocidade > 18 || rajada > 25 || probChuva > 25 || visibilidadeKm < 6 || valorKp >= 4) {
            statusBox.style.backgroundColor = '#ffc107';
            statusBox.style.color = '#000';
            statusTexto.innerText = '⚠️ Voo com Cautela / Atenção';
        } else {
            statusBox.style.backgroundColor = '#28a745';
            statusBox.style.color = '#fff';
            statusTexto.innerText = '✅ Excelentes Condições para Voo';
        }
    }
}

function obterIndiceHoraMaisProxima(horas) {
    const horaAtualNum = new Date().getHours();
    let maisProximo = 0;
    let menorDif = 999;
    horas.forEach((h, idx) => {
        const horaH = parseInt(h.hora.split(':')[0], 10);
        const dif = Math.abs(horaH - horaAtualNum);
        if (dif < menorDif) {
            menorDif = dif;
            maisProximo = idx;
        }
    });
    return maisProximo;
}

let coordenadasAtuais = { lat: -27.5954, lon: -48.6186, nome: 'Kobrasol, São José' };

async function carregarPrevisaoOpenMeteo(lat, lon, nomeLocal, forcarAtualizacao = false) {
    try {
        coordenadasAtuais = { lat, lon, nome: nomeLocal };

        // Se não for atualização forçada, verifica se há dados em cache válidos
        if (!forcarAtualizacao) {
            const cacheRecente = obterDoCache(lat, lon);
            if (cacheRecente) {
                indiceKpAtual = cacheRecente.kp;
                dadosAtuaisTempoReal = cacheRecente.current || null;
                dadosPrevisaoPorDia = cacheRecente.dias;
                definirTexto('nomeLocal', 'Local: ' + nomeLocal);
                atualizarLabelsAbas(dadosPrevisaoPorDia);
                inicializarMapa(lat, lon);
                mudarAba(0);
                return;
            }
        }

        definirTexto('textoStatus', '⏳ Atualizando...');
        
        const urlMeteo = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,rain,showers,weather_code,cloud_cover,visibility,wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_direction_10m,wind_direction_120m,wind_gusts_10m&daily=sunrise,sunset&wind_speed_unit=kmh&timezone=auto&forecast_days=7`;

        const [resMeteo, kp] = await Promise.all([
            fetch(urlMeteo).then(r => r.json()),
            buscarIndiceKpSolar()
        ]);

        indiceKpAtual = kp;
        dadosAtuaisTempoReal = resMeteo.current || null;

        if (!resMeteo || !resMeteo.hourly) {
            throw new Error('Não foi possível obter a previsão horária.');
        }

        dadosPrevisaoPorDia = agruparDadosOpenMeteo(resMeteo);
        definirTexto('nomeLocal', 'Local: ' + nomeLocal);

        // Salva no cache local para navegação ultra rápida
        salvarNoCache(lat, lon, {
            kp: kp,
            current: dadosAtuaisTempoReal,
            dias: dadosPrevisaoPorDia
        });

        atualizarLabelsAbas(dadosPrevisaoPorDia);
        inicializarMapa(lat, lon);
        mudarAba(0);

    } catch (erro) {
        console.error(erro);
        definirTexto('textoStatus', '❌ Erro na consulta');
        const statusBox = document.getElementById('statusVoo');
        if (statusBox) {
            statusBox.style.backgroundColor = '#dc3545';
            statusBox.style.color = '#fff';
        }
    }
}

async function recarregarPrevisaoForcada() {
    if (coordenadasAtuais && coordenadasAtuais.lat) {
        // Limpa cache específico
        try {
            const chave = `${CACHE_KEY_PREFIX}${coordenadasAtuais.lat.toFixed(3)}_${coordenadasAtuais.lon.toFixed(3)}`;
            localStorage.removeItem(chave);
        } catch (e) {}
        await carregarPrevisaoOpenMeteo(coordenadasAtuais.lat, coordenadasAtuais.lon, coordenadasAtuais.nome, true);
    } else {
        buscarPorGPS();
    }
}

async function buscarPorCidade() {
    const elCampo = document.getElementById('campoCidade');
    const cidade = elCampo ? elCampo.value.trim() : '';
    if (!cidade) return alert('Por favor, digite o nome de uma cidade.');
    definirTexto('textoStatus', '⏳ Localizando...');

    try {
        const urlGeo = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cidade)}&count=1&language=pt&format=json`;
        const resGeo = await fetch(urlGeo).then(r => r.json());

        if (!resGeo || !resGeo.results || resGeo.results.length === 0) {
            throw new Error('Cidade não encontrada.');
        }

        const lugar = resGeo.results[0];
        const nomeFormatado = `${lugar.name}${lugar.admin1 ? ', ' + lugar.admin1 : ''}`;

        await carregarPrevisaoOpenMeteo(lugar.latitude, lugar.longitude, nomeFormatado);
    } catch (e) {
        alert(e.message);
        definirTexto('textoStatus', '❌ Cidade não encontrada');
    }
}

function buscarPorGPS() {
    if (!navigator.geolocation) return alert('Sem suporte a GPS.');
    definirTexto('textoStatus', '⏳ Obtendo GPS...');

    navigator.geolocation.getCurrentPosition(async (posicao) => {
        try {
            const lat = posicao.coords.latitude;
            const lon = posicao.coords.longitude;
            const bairro = await descobrirBairroExato(lat, lon);
            const nomeFinal = bairro || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
            await carregarPrevisaoOpenMeteo(lat, lon, nomeFinal);
        } catch (erro) {
            console.error(erro);
            definirTexto('textoStatus', '❌ Erro ao obter local');
        }
    }, (err) => {
        console.warn('GPS negado:', err);
        buscarPorCidadePadrao();
    }, { enableHighAccuracy: true, timeout: 10000 });
}

function buscarPorCidadePadrao() {
    carregarPrevisaoOpenMeteo(-27.5954, -48.6186, 'Kobrasol, São José');
}

window.mudarAltitude = mudarAltitude;
window.mudarAba = mudarAba;
window.buscarPorCidade = buscarPorCidade;
window.buscarPorGPS = buscarPorGPS;
window.recarregarPrevisaoForcada = recarregarPrevisaoForcada;

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('SW registrado com sucesso:', reg.scope))
        .catch(err => console.warn('Erro ao registrar SW:', err));
}

window.onload = function() {
    inicializarMapa();
    buscarPorGPS();
};
