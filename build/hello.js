import {
  validate_component
} from "./chunk.TQ6P2IFW.js";
import {
  Counter_default,
  create_ssr_component,
  escape
} from "./chunk.NJXX4GOR.js";

// example/hello.svx
var metadata = {
  title: "hello",
  color: "pink",
  count: 42
};
var {title, color, count} = metadata;
var Hello = create_ssr_component(($$result, $$props, $$bindings, slots) => {
  return `<h1>HELLO ${escape(title)}</h1>
${validate_component(Counter_default, "Counter").$$render($$result, {value: count}, {}, {})}`;
});
var hello_default = Hello;
export {
  hello_default as default,
  metadata
};
