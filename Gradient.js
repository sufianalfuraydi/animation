function normalizeColor(hexCode) {
    return [(hexCode >> 16 & 255) / 255, (hexCode >> 8 & 255) / 255, (255 & hexCode) / 255];
}

class MiniGl {
    constructor(canvas, width, height, debug = false) {
        const _miniGl = this;
        const debug_output = -1 !== document.location.search.toLowerCase().indexOf("debug=webgl");
        _miniGl.canvas = canvas;
        _miniGl.gl = _miniGl.canvas.getContext("webgl", { antialias: true });
        _miniGl.meshes = [];
        const context = _miniGl.gl;
        width && height && this.setSize(width, height);
        _miniGl.lastDebugMsg = null;
        _miniGl.debug = debug && debug_output ? function (msg) {
            const t = new Date();
            if (t - _miniGl.lastDebugMsg > 1e3) console.log("---");
            console.log(t.toLocaleTimeString() + " " + msg + ": ", ...Array.from(arguments).slice(1));
            _miniGl.lastDebugMsg = t;
        } : () => { };

        Object.defineProperties(_miniGl, {
            Material: {
                enumerable: false,
                value: class {
                    constructor(vertexShaders, fragments, uniforms = {}) {
                        const material = this;

                        function getShaderByType(type, source) {
                            const shader = context.createShader(type);
                            context.shaderSource(shader, source);
                            context.compileShader(shader);
                            if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
                                console.error(context.getShaderInfoLog(shader));
                            }
                            _miniGl.debug("Material.compileShaderSource", { source });
                            return shader;
                        }

                        function getUniformVariableDeclarations(uniforms, type) {
                            return Object.entries(uniforms)
                                .map(([uniform, value]) => {
                                    if (value && typeof value.getDeclaration === 'function') {
                                        return value.getDeclaration(uniform, type);
                                    } else {
                                        console.error(`Uniform ${uniform} has no getDeclaration method`);
                                        return "";
                                    }
                                })
                                .join("\n");
                        }

                        material.uniforms = uniforms;
                        material.uniformInstances = [];

                        const prefix = "precision highp float;";
                        material.vertexSource = `
                            ${prefix}
                            attribute vec4 position;
                            attribute vec2 uv;
                            attribute vec2 uvNorm;
                            ${getUniformVariableDeclarations(_miniGl.commonUniforms, "vertex")}
                            ${getUniformVariableDeclarations(uniforms, "vertex")}
                            ${vertexShaders}
                        `;
                        material.Source = `
                            ${prefix}
                            ${getUniformVariableDeclarations(_miniGl.commonUniforms, "fragment")}
                            ${getUniformVariableDeclarations(uniforms, "fragment")}
                            ${fragments}
                        `;
                        material.vertexShader = getShaderByType(context.VERTEX_SHADER, material.vertexSource);
                        material.fragmentShader = getShaderByType(context.FRAGMENT_SHADER, material.Source);
                        material.program = context.createProgram();
                        context.attachShader(material.program, material.vertexShader);
                        context.attachShader(material.program, material.fragmentShader);
                        context.linkProgram(material.program);
                        if (!context.getProgramParameter(material.program, context.LINK_STATUS)) {
                            console.error(context.getProgramInfoLog(material.program));
                        }
                        context.useProgram(material.program);
                        material.attachUniforms(void 0, _miniGl.commonUniforms);
                        material.attachUniforms(void 0, material.uniforms);
                    }

                    attachUniforms(name, uniforms) {
                        const material = this;
                        if (typeof name === "undefined") {
                            Object.entries(uniforms).forEach(([name, uniform]) => {
                                material.attachUniforms(name, uniform);
                            });
                        } else if (uniforms.type === "array") {
                            uniforms.value.forEach((uniform, i) => {
                                material.attachUniforms(`${name}[${i}]`, uniform);
                            });
                        } else if (uniforms.type === "struct") {
                            Object.entries(uniforms.value).forEach(([uniform, i]) => {
                                material.attachUniforms(`${name}.${uniform}`, i);
                            });
                        } else {
                            _miniGl.debug("Material.attachUniforms", { name, uniform: uniforms });
                            material.uniformInstances.push({
                                uniform: uniforms,
                                location: context.getUniformLocation(material.program, name),
                            });
                        }
                    }
                }
            },
            Uniform: {
                enumerable: false,
                value: class {
                    constructor(e) {
                        this.type = "float";
                        Object.assign(this, e);
                        this.typeFn = {
                            float: "1f",
                            int: "1i",
                            vec2: "2fv",
                            vec3: "3fv",
                            vec4: "4fv",
                            mat4: "Matrix4fv",
                        }[this.type] || "1f";
                        this.update();
                    }

                    update(value) {
                        if (typeof this.value !== "undefined") {
                            context[`uniform${this.typeFn}`](
                                value,
                                this.typeFn.indexOf("Matrix") === 0 ? this.transpose : this.value,
                                this.typeFn.indexOf("Matrix") === 0 ? this.value : null
                            );
                        }
                    }

                    getDeclaration(name, type, length) {
                        const uniform = this;
                        if (uniform.excludeFrom !== type) {
                            if (uniform.type === "array") {
                                return `${uniform.value[0].getDeclaration(name, type, uniform.value.length)}\nconst int ${name}_length = ${uniform.value.length};`;
                            }
                            if (uniform.type === "struct") {
                                let name_no_prefix = name.replace("u_", "");
                                name_no_prefix = name_no_prefix.charAt(0).toUpperCase() + name_no_prefix.slice(1);
                                return `uniform struct ${name_no_prefix} {\n${Object.entries(uniform.value)
                                    .map(([name, uniform]) => uniform.getDeclaration(name, type).replace(/^uniform/, ""))
                                    .join("")}\n} ${name}${length > 0 ? `[${length}]` : ""};`;
                            }
                            return `uniform ${uniform.type} ${name}${length > 0 ? `[${length}]` : ""};`;
                        }
                    }
                }
            },
            PlaneGeometry: {
                enumerable: false,
                value: class {
                    constructor(width, height, n, i, orientation) {
                        context.createBuffer();
                        this.attributes = {
                            position: new _miniGl.Attribute({
                                target: context.ARRAY_BUFFER,
                                size: 3,
                            }),
                            uv: new _miniGl.Attribute({
                                target: context.ARRAY_BUFFER,
                                size: 2,
                            }),
                            uvNorm: new _miniGl.Attribute({
                                target: context.ARRAY_BUFFER,
                                size: 2,
                            }),
                            index: new _miniGl.Attribute({
                                target: context.ELEMENT_ARRAY_BUFFER,
                                size: 3,
                                type: context.UNSIGNED_SHORT,
                            }),
                        };
                        this.setTopology(n, i);
                        this.setSize(width, height, orientation);
                    }

                    setTopology(e = 1, t = 1) {
                        const n = this;
                        n.xSegCount = e;
                        n.ySegCount = t;
                        n.vertexCount = (n.xSegCount + 1) * (n.ySegCount + 1);
                        n.quadCount = n.xSegCount * n.ySegCount * 2;
                        n.attributes.uv.values = new Float32Array(2 * n.vertexCount);
                        n.attributes.uvNorm.values = new Float32Array(2 * n.vertexCount);
                        n.attributes.index.values = new Uint16Array(3 * n.quadCount);
                        for (let e = 0; e <= n.ySegCount; e++) {
                            for (let t = 0; t <= n.xSegCount; t++) {
                                const i = e * (n.xSegCount + 1) + t;
                                n.attributes.uv.values[2 * i] = t / n.xSegCount;
                                n.attributes.uv.values[2 * i + 1] = 1 - e / n.ySegCount;
                                n.attributes.uvNorm.values[2 * i] = t / n.xSegCount * 2 - 1;
                                n.attributes.uvNorm.values[2 * i + 1] = 1 - e / n.ySegCount * 2;
                                if (t < n.xSegCount && e < n.ySegCount) {
                                    const s = e * n.xSegCount + t;
                                    n.attributes.index.values[6 * s] = i;
                                    n.attributes.index.values[6 * s + 1] = i + 1 + n.xSegCount;
                                    n.attributes.index.values[6 * s + 2] = i + 1;
                                    n.attributes.index.values[6 * s + 3] = i + 1;
                                    n.attributes.index.values[6 * s + 4] = i + 1 + n.xSegCount;
                                    n.attributes.index.values[6 * s + 5] = i + 2 + n.xSegCount;
                                }
                            }
                        }
                        n.attributes.uv.update();
                        n.attributes.uvNorm.update();
                        n.attributes.index.update();
                        _miniGl.debug("Geometry.setTopology", {
                            uv: n.attributes.uv,
                            uvNorm: n.attributes.uvNorm,
                            index: n.attributes.index,
                        });
                    }

                    setSize(width = 1, height = 1, orientation = "xz") {
                        const geometry = this;
                        geometry.width = width;
                        geometry.height = height;
                        geometry.orientation = orientation;
                        geometry.attributes.position.values && geometry.attributes.position.values.length === 3 * geometry.vertexCount ||
                            (geometry.attributes.position.values = new Float32Array(3 * geometry.vertexCount));
                        const o = width / -2;
                        const r = height / -2;
                        const segment_width = width / geometry.xSegCount;
                        const segment_height = height / geometry.ySegCount;
                        for (let yIndex = 0; yIndex <= geometry.ySegCount; yIndex++) {
                            const t = r + yIndex * segment_height;
                            for (let xIndex = 0; xIndex <= geometry.xSegCount; xIndex++) {
                                const r = o + xIndex * segment_width;
                                const l = yIndex * (geometry.xSegCount + 1) + xIndex;
                                geometry.attributes.position.values[3 * l + "xyz".indexOf(orientation[0])] = r;
                                geometry.attributes.position.values[3 * l + "xyz".indexOf(orientation[1])] = -t;
                            }
                        }
                        geometry.attributes.position.update();
                        _miniGl.debug("Geometry.setSize", {
                            position: geometry.attributes.position,
                        });
                    }
                }
            },
            Mesh: {
                enumerable: false,
                value: class {
                    constructor(geometry, material) {
                        const mesh = this;
                        mesh.geometry = geometry;
                        mesh.material = material;
                        mesh.wireframe = false;
                        mesh.attributeInstances = [];
                        Object.entries(mesh.geometry.attributes).forEach(([e, attribute]) => {
                            mesh.attributeInstances.push({
                                attribute,
                                location: attribute.attach(e, mesh.material.program),
                            });
                        });
                        _miniGl.meshes.push(mesh);
                        _miniGl.debug("Mesh.constructor", { mesh });
                    }

                    draw() {
                        context.useProgram(this.material.program);
                        this.material.uniformInstances.forEach(({ uniform, location }) => {
                            uniform.update(location);
                        });
                        this.attributeInstances.forEach(({ attribute, location }) => {
                            attribute.use(location);
                        });
                        context.drawElements(this.wireframe ? context.LINES : context.TRIANGLES, this.geometry.attributes.index.values.length, context.UNSIGNED_SHORT, 0);
                    }

                    remove() {
                        _miniGl.meshes = _miniGl.meshes.filter(e => e != this);
                    }
                }
            },
            Attribute: {
                enumerable: false,
                value: class {
                    constructor(e) {
                        this.type = context.FLOAT;
                        this.normalized = false;
                        this.buffer = context.createBuffer();
                        Object.assign(this, e);
                        this.update();
                    }

                    update() {
                        if (typeof this.values !== "undefined") {
                            context.bindBuffer(this.target, this.buffer);
                            context.bufferData(this.target, this.values, context.STATIC_DRAW);
                        }
                    }

                    attach(e, t) {
                        const n = context.getAttribLocation(t, e);
                        if (this.target === context.ARRAY_BUFFER) {
                            context.enableVertexAttribArray(n);
                            context.vertexAttribPointer(n, this.size, this.type, this.normalized, 0, 0);
                        }
                        return n;
                    }

                    use(e) {
                        context.bindBuffer(this.target, this.buffer);
                        if (this.target === context.ARRAY_BUFFER) {
                            context.enableVertexAttribArray(e);
                            context.vertexAttribPointer(e, this.size, this.type, this.normalized, 0, 0);
                        }
                    }
                }
            }
        });

        const a = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        _miniGl.commonUniforms = {
            projectionMatrix: new _miniGl.Uniform({ type: "mat4", value: a }),
            modelViewMatrix: new _miniGl.Uniform({ type: "mat4", value: a }),
            resolution: new _miniGl.Uniform({ type: "vec2", value: [1, 1] }),
            aspectRatio: new _miniGl.Uniform({ type: "float", value: 1 }),
        };
    }

    setSize(e = 640, t = 480) {
        this.width = e;
        this.height = t;
        this.canvas.width = e;
        this.canvas.height = t;
        this.gl.viewport(0, 0, e, t);
        this.commonUniforms.resolution.value = [e, t];
        this.commonUniforms.aspectRatio.value = e / t;
        this.debug("MiniGL.setSize", { width: e, height: t });
    }

    setOrthographicCamera(e = 0, t = 0, n = 0, i = -2e3, s = 2e3) {
        this.commonUniforms.projectionMatrix.value = [2 / this.width, 0, 0, 0, 0, 2 / this.height, 0, 0, 0, 0, 2 / (i - s), 0, e, t, n, 1];
        this.debug("setOrthographicCamera", this.commonUniforms.projectionMatrix.value);
    }

    render() {
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clearDepth(1);
        this.meshes.forEach(e => e.draw());
    }
}

// Gradient object
class Gradient {
    constructor(...t) {
        try {
            e(this, "el", void 0);
            e(this, "cssVarRetries", 0);
            e(this, "maxCssVarRetries", 200);
            e(this, "angle", 0);
            e(this, "isLoadedClass", false);
            e(this, "isScrolling", false);
            e(this, "scrollingTimeout", void 0);
            e(this, "scrollingRefreshDelay", 200);
            e(this, "isIntersecting", false);
            e(this, "shaderFiles", void 0);
            e(this, "vertexShader", void 0);
            e(this, "sectionColors", void 0);
            e(this, "computedCanvasStyle", void 0);
            e(this, "conf", void 0);
            e(this, "uniforms", void 0);
            e(this, "t", 1253106);
            e(this, "last", 0);
            e(this, "width", void 0);
            e(this, "minWidth", 1111);
            e(this, "height", 600);
            e(this, "xSegCount", void 0);
            e(this, "ySegCount", void 0);
            e(this, "mesh", void 0);
            e(this, "material", void 0);
            e(this, "geometry", void 0);
            e(this, "minigl", void 0);
            e(this, "scrollObserver", void 0);
            e(this, "amp", 320);
            e(this, "seed", 5);
            e(this, "freqX", 14e-5);
            e(this, "freqY", 29e-5);
            e(this, "freqDelta", 1e-5);
            e(this, "activeColors", [1, 1, 1, 1]);
            e(this, "isMetaKey", false);
            e(this, "isGradientLegendVisible", false);
            e(this, "isMouseDown", false);
            e(this, "handleScroll", () => {
                clearTimeout(this.scrollingTimeout);
                this.scrollingTimeout = setTimeout(this.handleScrollEnd, this.scrollingRefreshDelay);
                this.isGradientLegendVisible && this.hideGradientLegend();
                this.conf.playing && (this.isScrolling = true, this.pause());
            });
            e(this, "handleScrollEnd", () => {
                this.isScrolling = false;
                this.isIntersecting && this.play();
            });
            e(this, "resize", () => {
                this.width = window.innerWidth;
                this.minigl.setSize(this.width, this.height);
                this.minigl.setOrthographicCamera();
                this.xSegCount = Math.ceil(this.width * this.conf.density[0]);
                this.ySegCount = Math.ceil(this.height * this.conf.density[1]);
                this.mesh.geometry.setTopology(this.xSegCount, this.ySegCount);
                this.mesh.geometry.setSize(this.width, this.height);
                this.mesh.material.uniforms.u_shadow_power.value = this.width < 600 ? 5 : 6;
            });
            e(this, "handleMouseDown", e => {
                this.isGradientLegendVisible && (this.isMetaKey = e.metaKey, this.isMouseDown = true, false === this.conf.playing && requestAnimationFrame(this.animate));
            });
            e(this, "handleMouseUp", () => {
                this.isMouseDown = false;
            });
            e(this, "animate", e => {
                if (!this.shouldSkipFrame(e) || this.isMouseDown) {
                    this.t += Math.min(e - this.last, 1e3 / 15);
                    this.last = e;
                    if (this.isMouseDown) {
                        let e = 160;
                        this.isMetaKey && (e = -160);
                        this.t += e;
                    }
                    this.mesh.material.uniforms.u_time.value = this.t;
                    this.minigl.render();
                }
                if (0 !== this.last && this.isStatic) return this.minigl.render(), void this.disconnect();
                (this.conf.playing || this.isMouseDown) && requestAnimationFrame(this.animate);
            });
            e(this, "addIsLoadedClass", () => {
                !this.isLoadedClass && (this.isLoadedClass = true, this.el.classList.add("isLoaded"), setTimeout(() => {
                    this.el.parentElement.classList.add("isLoaded");
                }, 3e3));
            });
            e(this, "pause", () => {
                this.conf.playing = false;
            });
            e(this, "play", () => {
                requestAnimationFrame(this.animate);
                this.conf.playing = true;
            });
            e(this, "initGradient", selector => {
                this.el = document.querySelector(selector);
                this.connect();
                return this;
            });
        } catch (error) {
            console.error("Error initializing Gradient:", error);
        }
    }

    async connect() {
        try {
            this.shaderFiles = {
                vertex: `varying vec3 v_color;
                void main() {
                    float time = u_time * u_global.noiseSpeed;
                    vec2 noiseCoord = resolution * uvNorm * u_global.noiseFreq;
                    vec2 st = 1. - uvNorm.xy;
                    // Tilting the plane
                    // Front-to-back tilt
                    float tilt = resolution.y / 2.0 * uvNorm.y;
                    // Left-to-right angle
                    float incline = resolution.x * uvNorm.x / 2.0 * u_vertDeform.incline;
                    // Up-down shift to offset incline
                    float offset = resolution.x / 2.0 * u_vertDeform.incline * mix(u_vertDeform.offsetBottom, u_vertDeform.offsetTop, uv.y);
                    // Vertex noise
                    float noise = snoise(vec3(noiseCoord.x * u_vertDeform.noiseFreq.x + time * u_vertDeform.noiseFlow, noiseCoord.y * u_vertDeform.noiseFreq.y, time * u_vertDeform.noiseSpeed + u_vertDeform.noiseSeed)) * u_vertDeform.noiseAmp;
                    // Fade noise to zero at edges
                    noise *= 1.0 - pow(abs(uvNorm.y), 2.0);
                    // Clamp to 0
                    noise = max(0.0, noise);
                    vec3 pos = vec3(position.x, position.y + tilt + incline + noise - offset, position.z);
                    if (u_active_colors[0] == 1.) {
                        v_color = u_baseColor;
                    }
                    for (int i = 0; i < u_waveLayers_length; i++) {
                        if (u_active_colors[i + 1] == 1.) {
                            WaveLayers layer = u_waveLayers[i];
                            float noise = smoothstep(layer.noiseFloor, layer.noiseCeil, snoise(vec3(noiseCoord.x * layer.noiseFreq.x + time * layer.noiseFlow, noiseCoord.y * layer.noiseFreq.y, time * layer.noiseSpeed + layer.noiseSeed)) / 2.0 + 0.5);
                            v_color = blendNormal(v_color, layer.color, pow(noise, 4.));
                        }
                    }
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }`,
                noise: `vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                float snoise(vec3 v) {
                    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
                    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i  = floor(v + dot(v, C.yyy) );
                    vec3 x0 =   v - i + dot(i, C.xxx) ;
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min( g.xyz, l.zxy );
                    vec3 i2 = max( g.xyz, l.zxy );
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                    i = mod289(i);
                    vec4 p = permute( permute( permute(
                    i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
                    vec4 j = p - 49.0 * floor(p * vec4(1.0 / 7.0));
                    vec4 x_ = floor(j * vec4(1.0 / 7.0));
                    vec4 y_ = floor(j - 7.0 * x_);
                    vec4 x = x_ * vec4(1.0 / 7.0) + vec4(1.0 / 14.0);
                    vec4 y = y_ * vec4(1.0 / 7.0) + vec4(1.0 / 14.0);
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4( x.xy, y.xy );
                    vec4 b1 = vec4( x.zw, y.zw );
                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
                    vec3 p0 = vec3(a0.xy,h.x);
                    vec3 p1 = vec3(a0.zw,h.y);
                    vec3 p2 = vec3(a1.xy,h.z);
                    vec3 p3 = vec3(a1.zw,h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                    p0 *= norm.x;
                    p1 *= norm.y;
                    p2 *= norm.z;
                    p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
                }`,
                blend: `vec3 blendNormal(vec3 base, vec3 blend) { return blend; }
                vec3 blendNormal(vec3 base, vec3 blend, float opacity) { return (blendNormal(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendScreen(float base, float blend) { return 1.0-((1.0-base)*(1.0-blend)); }
                vec3 blendScreen(vec3 base, vec3 blend) { return vec3(blendScreen(base.r,blend.r),blendScreen(base.g,blend.g),blendScreen(base.b,blend.b)); }
                vec3 blendScreen(vec3 base, vec3 blend, float opacity) { return (blendScreen(base, blend) * opacity + base * (1.0 - opacity)); }
                vec3 blendMultiply(vec3 base, vec3 blend) { return base*blend; }
                vec3 blendMultiply(vec3 base, vec3 blend, float opacity) { return (blendMultiply(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendOverlay(float base, float blend) { return base<0.5?(2.0*base*blend):(1.0-2.0*(1.0-base)*(1.0-blend)); }
                vec3 blendOverlay(vec3 base, vec3 blend) { return vec3(blendOverlay(base.r,blend.r),blendOverlay(base.g,blend.g),blendOverlay(base.b,blend.b)); }
                vec3 blendOverlay(vec3 base, vec3 blend, float opacity) { return (blendOverlay(base, blend) * opacity + base * (1.0 - opacity)); }
                vec3 blendHardLight(vec3 base, vec3 blend) { return blendOverlay(blend,base); }
                vec3 blendHardLight(vec3 base, vec3 blend, float opacity) { return (blendHardLight(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendSoftLight(float base, float blend) { return (blend<0.5)?(2.0*base*blend+base*base*(1.0-2.0*blend)):(sqrt(base)*(2.0*blend-1.0)+2.0*base*(1.0-blend)); }
                vec3 blendSoftLight(vec3 base, vec3 blend) { return vec3(blendSoftLight(base.r,blend.r),blendSoftLight(base.g,blend.g),blendSoftLight(base.b,blend.b)); }
                vec3 blendSoftLight(vec3 base, vec3 blend, float opacity) { return (blendSoftLight(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendColorDodge(float base, float blend) { return (blend==1.0)?blend:min(base/(1.0-blend),1.0); }
                vec3 blendColorDodge(vec3 base, vec3 blend) { return vec3(blendColorDodge(base.r,blend.r),blendColorDodge(base.g,blend.g),blendColorDodge(base.b,blend.b)); }
                vec3 blendColorDodge(vec3 base, vec3 blend, float opacity) { return (blendColorDodge(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendColorBurn(float base, float blend) { return (blend==0.0)?blend:max((1.0-((1.0-base)/blend)),0.0); }
                vec3 blendColorBurn(vec3 base, vec3 blend) { return vec3(blendColorBurn(base.r,blend.r),blendColorBurn(base.g,blend.g),blendColorBurn(base.b,blend.b)); }
                vec3 blendColorBurn(vec3 base, vec3 blend, float opacity) { return (blendColorBurn(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendVividLight(float base, float blend) { return (blend<0.5)?blendColorBurn(base,(2.0*blend)):blendColorDodge(base,(2.0*(blend-0.5))); }
                vec3 blendVividLight(vec3 base, vec3 blend) { return vec3(blendVividLight(base.r,blend.r),blendVividLight(base.g,blend.g),blendVividLight(base.b,blend.b)); }
                vec3 blendVividLight(vec3 base, vec3 blend, float opacity) { return (blendVividLight(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendLighten(float base, float blend) { return max(blend,base); }
                vec3 blendLighten(vec3 base, vec3 blend) { return vec3(blendLighten(base.r,blend.r),blendLighten(base.g,blend.g),blendLighten(base.b,blend.b)); }
                vec3 blendLighten(vec3 base, vec3 blend, float opacity) { return (blendLighten(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendLinearBurn(float base, float blend) { return max(base+blend-1.0,0.0); }
                vec3 blendLinearBurn(vec3 base, vec3 blend) { return max(base+blend-vec3(1.0),vec3(0.0)); }
                vec3 blendLinearBurn(vec3 base, vec3 blend, float opacity) { return (blendLinearBurn(base, blend) * opacity + base * (1.0 - opacity)); }
                float blendLinearDodge(float base, float blend) { return min(base+blend,1.0); }
                vec3 blendLinearDodge(vec3 base, vec3 blend) { return min(base+blend,vec3(1.0)); }
                vec3 blendLinearDodge(vec3 base, vec3 blend, float opacity) { return (blendLinearDodge(base, blend) * opacity + base * (1.0 - opacity)); }`,
            };
            this.vertexShader = this.shaderFiles.vertex;
            this.initMesh();
        } catch (error) {
            console.error("Error connecting Gradient:", error);
        }
    }
}

window.Gradient = Gradient;
