import {
  validate_component
} from "./chunk.TQ6P2IFW.js";
import {
  Counter_default,
  create_ssr_component,
  escape
} from "./chunk.NJXX4GOR.js";

// example/demo.svx
var metadata = {
  title: "demo",
  color: "cadetblue",
  count: 12
};
var {title, color, count} = metadata;
var number = 45;
var Demo = create_ssr_component(($$result, $$props, $$bindings, slots) => {
  import("./048321767700424da66a3264b40befa09a0df93c00c26a13c37cf8ee015825eb.hydrate.js");
  return `<h1>${escape(title)}</h1>
<h2>Good stuff in your markdown</h2>
<p>Markdown is pretty good but sometimes you just need more.</p>
<p>Sometimes you need a boinger like this:</p>
<div data-hydrate="${"048321767700424da66a3264b40befa09a0df93c00c26a13c37cf8ee015825eb"}">${validate_component(Counter_default, "Counter").$$render($$result, {value: number}, {}, {})}
</div>${'<script defer type="module" src="/Users/lukee/repos/oss/ssg/example/048321767700424da66a3264b40befa09a0df93c00c26a13c37cf8ee015825eb.hydrate.svelte"></script>'}`;
});
var demo_default = Demo;
export {
  demo_default as default,
  metadata
};
