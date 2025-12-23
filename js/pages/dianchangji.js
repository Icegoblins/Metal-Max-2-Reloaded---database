window.jukeboxMgr = {
    currentIndex: -1,
    timer: null,


    playMode: 0, // 0: 列表循环, 1: 单曲循环, 2: 随机播放
    playlist: [], // 新增：专门存放点唱机的歌曲列表，不随页面切换改变
    modeLabels: ["列表循环", "单曲循环", "随机模式"],
    history: [], // 随机去重：记录哪些歌还没播，播完一轮才清空
    playStack: [], // 播放足迹：记录用户实际听歌的先后顺序，用于“上一首”回溯
    audioCtx: null,
    analyser: null,
    source: null,
    isFading: false,

    initAudioContext: function () {
        if (this.audioCtx) return;
        const audio = document.getElementById('global-audio-engine');
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioCtx.createAnalyser();
        this.source = this.audioCtx.createMediaElementSource(audio);
        this.source.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
        this.analyser.fftSize = 256;
    },

    // 实现淡入淡出播放/暂停
    fade: function (type, callback) {
        const audio = document.getElementById('global-audio-engine');
        if (this.isFading) return;
        this.isFading = true;

        let targetVol = type === 'in' ? (parseInt(document.getElementById('vol-control-input')?.value || 100) / 100) : 0;
        let startVol = audio.volume;
        let step = (targetVol - startVol) / 20; // 200ms 内完成
        let count = 0;

        let interval = setInterval(() => {
            count++;
            audio.volume = Math.max(0, Math.min(1, audio.volume + step));
            if (count >= 20) {
                clearInterval(interval);
                audio.volume = targetVol;
                this.isFading = false;
                if (callback) callback();
            }
        }, 10);
    },

    init: function () {
        const audio = document.getElementById('global-audio-engine');
        if (!audio) return;

        // 核心修复 1：强制关闭原生循环，否则不会触发 onended
        audio.loop = false;

        // 核心修复 2：绑定结束事件
        audio.onended = () => {
            console.log("Track ended. Mode:", this.playMode);
            if (this.playMode === 1) {
                // 单曲循环模式
                audio.currentTime = 0;
                audio.play();
            } else {
                // 列表或随机模式统一由 next 处理
                this.next(true);
            }
        };
    },

    // 切换播放模式
    toggleMode: function () {
        this.playMode = (this.playMode + 1) % 3;
        const btn = document.getElementById('mode-btn');
        if (btn) btn.innerText = "MODE: " + this.modeLabels[this.playMode];

        // 视觉提示
        const logMsg = `>> SYSTEM: 播放模式已更改为 [${this.modeLabels[this.playMode]}]`;
        if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(logMsg);
    },

    next: function (isAuto = false) {
        let nextIdx;
        const total = window.currentRawData.length;

        if (this.playMode === 2) {
            // 随机播放：获取一个非当前的随机索引
            nextIdx = Math.floor(Math.random() * total);
        } else {
            // 列表循环
            nextIdx = this.currentIndex + 1;
            if (nextIdx >= total) nextIdx = 0;
        }
        this.select(nextIdx);
    },

    // 修正后的 seek 函数，确保点击在同一个元素上
    seek: function (e) {
        const audio = document.getElementById('global-audio-engine');
        if (!audio || !audio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const per = (e.clientX - rect.left) / rect.width;
        audio.currentTime = per * audio.duration;
        this.updateProgress();
    },

    // 强制初始化音频配置
    initAudio: function () {
        const audio = document.getElementById('global-audio-engine');
        if (!audio) return;
        audio.loop = false; // 严禁使用原生 loop
        audio.onended = () => {
            console.log(">> 播放结束，触发模式逻辑:", this.modeLabels[this.playMode]);
            if (this.playMode === 1) { // 单曲循环
                audio.currentTime = 0;
                audio.play();
            } else {
                this.next(true); // 自动切下一首
            }
        };
    },

    // 点击左侧列表项或右侧切歌时触发
    select: function(idx, isAuto = false, isBacktracking = false) {

        // 逻辑：如果是手动点击或初次播放，锁定当前的全局数据到私有列表
        if (!isAuto && window.currentRawData) {
            this.playlist = [...window.currentRawData];
        }
        const data = this.playlist;
        if (!data[idx]) return;

        this.fade('out', () => {
            // 如果不是在点击“上一首”（回溯），则将当前索引推入足迹栈
            if (!isBacktracking && this.currentIndex !== -1) {
                this.playStack.push(this.currentIndex);
                // 限制栈大小，防止内存占用过高（如记录最近50首）
                if (this.playStack.length > 50) this.playStack.shift();
            }

            this.currentIndex = idx;
            const audio = document.getElementById('global-audio-engine');
            const rawItem = data[idx];
            const songName = rawItem.标题 || rawItem.名称;

            // 强制覆盖顶部名称容器
            const detName = document.getElementById('det-name');
            if (detName) detName.innerText = songName;

            this.initAudio();

            // UI 更新与打字机触发
            const titleElem = document.getElementById('playing-title');
            if (titleElem) titleElem.innerText = "TRACK: " + songName;
            // 2. 核心：强制更新顶部那个显示“音乐点唱机”的容器
            const topBox = document.getElementById('item-title-box');
            if (topBox) topBox.innerText = songName;

            // 构建一个多行日志
            let logLines = [];

            // 如果 JSON 里有“作者”字段则增加
            if (rawItem.标题) {logLines.push(`>> 曲目: ${rawItem.标题}`);}
            if (rawItem.参与创作的艺术家) {logLines.push(`>> 作曲家: ${rawItem.参与创作的艺术家}`);}
            if (rawItem.唱片集) {logLines.push(`>> 专辑: ${rawItem.唱片集}`);}
            if (rawItem.流派) {logLines.push(`>> 类别: ${rawItem.流派}`);}
            if (rawItem.年) {logLines.push(`>> 发行: ${rawItem.年}`);}
            if (rawItem.比特率) {logLines.push(`>> 比特率: ${rawItem.比特率}`);}
            if (rawItem.频道) {logLines.push(`>> 频道: ${rawItem.频道}`);}
            if (rawItem.音频采样频率) {logLines.push(`>> 采样频率: ${rawItem.音频采样频率}`);}


            // 将数组转为字符串，用换行符连接
            const logMsg = logLines.join('\n');

            if (window.triggerGlobalTypewriter) window.triggerGlobalTypewriter(logMsg);

            audio.src = `music/${rawItem.文件名}`;
            audio.load();
            this.initAudioContext();

            audio.play().then(() => {
                this.fade('in');
                this.startAnimation();
                this.updateButton(true);
            });

            // 维护随机去重历史
            if (this.playMode === 2) {
                if (!this.history.includes(idx)) this.history.push(idx);
                if (this.history.length >= data.length) this.history = [idx];
            }

            document.querySelectorAll('#item-list .nav-item').forEach((li, i) => {
                li.classList.toggle('active', i === idx);
            });
        });
    },

    toggle: function() {
    const audio = document.getElementById('global-audio-engine');

    // 情况 A: 还没选歌，直接点开始
    if (this.currentIndex === -1) {
        this.select(0);
        return;
    }

    // 情况 B: 正在播放 -> 准备暂停
    if (!audio.paused) {
        // 强制先更新 UI，再执行淡出，增强交互响应速度
        this.updateButton(false);
        this.fade('out', () => {
            audio.pause();
            if (this.timer) cancelAnimationFrame(this.timer);
        });
    }
    // 情况 C: 已经暂停 -> 准备播放
    else {
        this.updateButton(true);
        this.initAudio();
        audio.play().then(() => {
            this.fade('in');
            this.startAnimation();
        }).catch(e => {
            console.error("Playback failed:", e);
            this.updateButton(false);
        });
    }
},

    // 优化后的上一首逻辑
    prev: function() {
        const data = this.playlist;
        if (!data || data.length === 0) return;

        if (this.playStack.length > 0) {
            // 核心优化：从足迹栈中弹出最后一首歌
            const lastIdx = this.playStack.pop();
            // 传入 isBacktracking=true，防止这首歌又被推入栈导致死循环
            this.select(lastIdx, true, true);
        } else {
            // 如果没有历史记录（刚打开第一首），则按列表顺序前移
            const total = data.length;
            let prevIdx = (this.currentIndex - 1 + total) % total;
            this.select(prevIdx, true); // 传 true，防止覆盖列表
        }
    },

    next: function(isAuto = false) {
        const data = this.playlist;
        const total = data.length;
        if (!data || data.length === 0) return; // 防止空列表崩溃
        let nextIdx;

        if (this.playMode === 2) {
            // 随机逻辑：寻找不在 history 中的索引
            let available = Array.from({length: total}, (v, i) => i)
                                 .filter(i => !this.history.includes(i));

            if (available.length === 0) {
                this.history = []; // 播完一轮，重置
                available = Array.from({length: total}, (v, i) => i).filter(i => i !== this.currentIndex);
            }
            nextIdx = available[Math.floor(Math.random() * available.length)];
        } else {
            nextIdx = (this.currentIndex + 1) % total;
        }
        this.select(nextIdx, true);
    },

    updateProgress: function() {
        const audio = document.getElementById('global-audio-engine');
        const bar = document.getElementById('prog-bar-inner');
        const timeDisp = document.getElementById('time-display');
        if (audio && audio.duration) {
            const per = (audio.currentTime / audio.duration) * 100;
            if (bar) bar.style.width = per + "%";
            if (timeDisp) timeDisp.innerText = `${this.formatTime(audio.currentTime)} / ${this.formatTime(audio.duration)}`;
        }
    },

    setVolume: function(val) {
        const audio = document.getElementById('global-audio-engine');
        audio.volume = val / 100;
        document.getElementById('vol-value').innerText = val + "%";
    },

    formatTime: s => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`,

    updateButton: function(isPlaying) {
        const btn = document.getElementById('play-pause-btn');
        if (!btn) return;

        // 如果还没选歌，显示开始
        if (this.currentIndex === -1) {
            btn.innerHTML = "开始";
            return;
        }
        if (btn) {
        // 正常的播放/暂停状态切换
        btn.innerHTML = isPlaying ? "暂停播放" : "继续播放";
        btn.classList.toggle('active', isPlaying);
        if(isPlaying) btn.classList.add('playing'); else btn.classList.remove('playing');}
    },

    startAnimation: function() {
    if (this.timer) cancelAnimationFrame(this.timer);
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const renderFrame = () => {
        this.analyser.getByteFrequencyData(dataArray);
        const bars = document.querySelectorAll('.v-bar');

        bars.forEach((bar, i) => {
            const val = dataArray[i % dataArray.length];
            const height = (val / 255) * 150; // 适当增加高度上限

            // 3. 计算颜色梯度：
            // 越往右（高频）或 越高（音量大）颜色越红
            const hue = 140 - (val / 255) * 140; // 140是绿色，0是红色

            bar.style.height = `${height}px`;
            // 使用 HSL 控制：绿色(140) -> 红色(0)
            bar.style.background = `linear-gradient(to top, #50ff7d, hsl(${hue}, 100%, 50%))`;
            bar.style.boxShadow = `0 0 10px hsla(${hue}, 100%, 50%, 0.5)`;
            bar.style.opacity = 0.4 + (val / 255) * 0.6;
        });

        this.updateProgress();
        this.timer = requestAnimationFrame(renderFrame);
    };
    renderFrame();
}}

const jukeboxRenderer = {
    skin: "skin-jukebox",
    renderStats: function(item) {
        const mgr = window.jukeboxMgr;

        const playingItem = (window.jukeboxMgr.currentIndex !== -1) ?
                    window.jukeboxMgr.playlist[window.jukeboxMgr.currentIndex] : item;
        const currentName = playingItem ? (playingItem.标题 || playingItem.名称) : "SYSTEM_READY";
        // 同时手动刷一下顶栏（防止渲染器只管局部而没管顶栏）
        const topBox = document.getElementById('item-title-box');
        if (topBox && window.jukeboxMgr.currentIndex !== -1) topBox.innerText = currentName;
        // 由于左侧列表已经在 test.html 的 renderList 处理，这里只渲染右侧控制面板
        return `
        <div class="pro-player-console" style="grid-column: 1 / -1;gap: 10px;">
            <div class="monitor-layout">
                <div class="cover-frame">
                    <img id="track-art" src="music/default.jpg">
                    <div class="frame-glitch"></div>
                </div>
                <div class="monitor-section" style="flex:1;">
                    <div class="v-canvas">
                        ${Array(108).fill('<div class="v-bar"></div>').join('')}
                    </div>
                    <div class="scan-line"></div>
                </div>
            </div>
            <div class="control-section">
                <div class="status-row">
                    <span class="tag">DECODING_REALTIME</span>
                    <span class="tag" style="color:#fff">WEB_AUDIO_V3</span>
                </div>
                <h2 id="playing-title" class="glitch-text">TRACK: ${currentName}</h2>
                <div class="playback-bar">
                    <div class="prog-bar-bg" onclick="jukeboxMgr.seek(event)">
                        <div id="prog-bar-inner"></div>
                    </div>
                    <div id="time-display">00:00 / 00:00</div>
                </div>
                <div class="interaction-grid">
                    <div class="btn-group">
                        <button class="mm-btn" id="mode-btn" onclick="jukeboxMgr.toggleMode()" style="min-width:130px;">MODE: 列表循环</button>
                        <button class="mm-btn" onclick="jukeboxMgr.prev()">上一首</button>
                        <button class="mm-btn active" id="play-pause-btn" onclick="jukeboxMgr.toggle()">
                            ${window.jukeboxMgr.currentIndex === -1 ? "开始" : (document.getElementById('global-audio-engine').paused ? "继续播放" : "暂停播放")}
                        </button>
                        <button class="mm-btn" onclick="jukeboxMgr.next()">下一首</button>
                    </div>
                    
                    <div class="vol-control">
                        <label>音量</label>
                        <input type="range" id="vol-control-input" min="0" max="100" value="100" oninput="jukeboxMgr.setVolume(this.value)">
                        <span id="vol-value">100%</span>
                    </div>
                </div>
            </div>
        </div>`;
    },
    onUpdateVisual: function() {
    const audio = document.getElementById('global-audio-engine');
    const mgr = window.jukeboxMgr;
    if (audio) {
        // 如果从未播放过，显示“开始”
        if (mgr.currentIndex === -1) {
            const btn = document.getElementById('play-pause-btn');
            if (btn) btn.innerHTML = "开始";
        } else {
            // 已经有歌在播了，根据播放状态显示 暂停/继续
            mgr.updateButton(!audio.paused);
        }

        if (!audio.paused) mgr.startAnimation();
    }
}
};

window.registerPageRenderer("点唱机", jukeboxRenderer);