function normalizeColor(hexCode) {
    return [(hexCode >> 16 & 255) / 255, (hexCode >> 8 & 255) / 255, (255 & hexCode) / 255];
}

class MiniGl {
    constructor(canvas, width, height) {
        this.canvas = canvas;
        this.gl = this.canvas.getContext("webgl", { antialias: true });
        this.meshes = [];
        this.setSize(width, height);

        // Ensure that commonUniforms uses the right context
        this.commonUniforms = {
            projectionMatrix: new MiniGl.Uniform({ type: "mat4", value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }),
            modelViewMatrix: new MiniGl.Uniform({ type: "mat4", value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }),
            resolution: new MiniGl.Uniform({ type: "vec2", value: [width, height] }),
            aspectRatio: new MiniGl.Uniform({ type: "float", value: width / height }),
        };
    }

    setSize(width, height) {
        this.width = width;
        this.height = height;
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
        this.commonUniforms.resolution.value = [width, height];
        this.commonUniforms.aspectRatio.value = width / height;
    }

    setOrthographicCamera() {
        const aspect = this.width / this.height;
        this.commonUniforms.projectionMatrix.value = [
            1 / aspect, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, -2 / (2000 - -2000), 0,
            0, 0, 0, 1
        ];
    }

    render() {
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clearDepth(1);
        this.meshes.forEach(mesh => mesh.draw());
    }

    static Uniform = class {
        constructor({ type, value }) {
            this.type = type;
            this.value = value;
            this.typeFn = {
                float: "1f",
                int: "1i",
                vec2: "2fv",
                vec3: "3fv",
                vec4: "4fv",
                mat4: "Matrix4fv"
            }[type] || "1f";
        }

        update(location) {
            if (this.value !== undefined) {
                this.gl[`uniform${this.typeFn}`](location, this.value);
            }
        }
    }
}

class Gradient {
    constructor() {
        this.canvas = document.querySelector('#gradient-canvas');
        this.minigl = new MiniGl(this.canvas, window.innerWidth, window.innerHeight);
        this.colors = [
            normalizeColor(0x6ec3f4),
            normalizeColor(0x3a3aff),
            normalizeColor(0xff61ab),
            normalizeColor(0xe63946)
        ];
        this.init();
    }

    init() {
        this.minigl.setOrthographicCamera();
        this.minigl.render();
        window.addEventListener("resize", this.onResize.bind(this));
    }

    onResize() {
        this.minigl.setSize(window.innerWidth, window.innerHeight);
        this.minigl.setOrthographicCamera();
        this.minigl.render();
    }
}

window.Gradient = Gradient;

