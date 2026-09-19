import{c,r as h,j as e,A as y,p as m,X as k,a as w,q as g}from"./index-C1m_Dmnw.js";/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=[["path",{d:"M4.929 4.929 19.07 19.071",key:"196cmz"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]],v=c("ban",j);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const N=[["path",{d:"m15 18-6-6 6-6",key:"1wnfg3"}]],$=c("chevron-left",N);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const A=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]],B=c("info",A);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E=[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 9.9-1",key:"1mm8w8"}]],C=c("lock-open",E);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _=[["path",{d:"M13 21h8",key:"1jsn5i"}],["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]],F=c("pen-line",_);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const z=[["path",{d:"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",key:"10ikf1"}]],D=c("play",z);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const L=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]],S=c("shield-alert",L);function W({isOpen:s,mode:t,targetUser:a,onConfirm:r,onClose:o}){const[i,d]=h.useState(!1);if(h.useEffect(()=>{s||d(!1)},[s]),h.useEffect(()=>{if(!s)return;const l=p=>{p.key==="Escape"&&!i&&o()};return window.addEventListener("keydown",l),()=>window.removeEventListener("keydown",l)},[s,i,o]),!s||!a)return null;const b=async()=>{if(!i){d(!0);try{await r()}catch(l){console.error("Error executing block/unblock action:",l),d(!1)}}},u=a.username?`@${a.username}`:a.fullName?a.fullName:"this user",n=t==="block";return e.jsx(y,{children:e.jsxs("div",{className:"fixed inset-0 z-[250] flex items-center justify-center p-4 select-none",role:"dialog","aria-modal":"true","aria-labelledby":"block-dialog-title",children:[e.jsx(m.div,{initial:{opacity:0},animate:{opacity:1},exit:{opacity:0},transition:{duration:.15},onClick:()=>{i||o()},className:"absolute inset-0 bg-black/75 backdrop-blur-md"}),e.jsxs(m.div,{initial:{opacity:0,scale:.94,y:15},animate:{opacity:1,scale:1,y:0},exit:{opacity:0,scale:.94,y:15},transition:{duration:.2,ease:[.16,1,.3,1]},className:"relative w-full max-w-sm bg-[#141417] text-[#F7F4EE] border border-white/10 rounded-3xl p-6 shadow-2xl overflow-hidden z-10",onClick:l=>l.stopPropagation(),children:[e.jsx("button",{onClick:()=>{i||o()},disabled:i,className:"absolute top-4 right-4 p-2 rounded-full text-[#A1A1AA] hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-40",title:"Cancel",children:e.jsx(k,{size:18})}),e.jsxs("div",{className:"flex flex-col items-center text-center mt-2 mb-4",children:[e.jsxs("div",{className:"relative mb-3.5",children:[e.jsx("div",{className:"w-16 h-16 rounded-full border-2 border-white/15 overflow-hidden shadow-lg flex items-center justify-center bg-[#1A1A1D]",children:e.jsx(w,{src:a.photoUrl,alt:a.fullName||"User",className:"w-full h-full object-cover",fallbackType:"profile",fullName:a.fullName,sizeType:"standard"})}),e.jsx("div",{className:`absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center border-2 border-[#141417] shadow-sm ${n?"bg-rose-600 text-white":"bg-[#C9A96E] text-[#0D0D0F]"}`,children:n?e.jsx(v,{size:12,strokeWidth:2.5}):e.jsx(C,{size:12,strokeWidth:2.5})})]}),e.jsx("h3",{id:"block-dialog-title",className:"text-base font-bold text-[#F7F4EE] tracking-tight font-display",children:n?"Block this user?":"Unblock this user?"}),e.jsx("p",{className:"text-xs text-[#A1A1AA] mt-2 leading-relaxed max-w-xs",children:n?`Are you sure you want to block ${u}? They won't be able to message, connect with, or interact with you.`:`Are you sure you want to unblock ${u}?`})]}),e.jsxs("div",{className:"flex items-center gap-3 mt-6",children:[e.jsx("button",{type:"button",id:"block-modal-cancel-btn",onClick:o,disabled:i,className:"flex-1 h-11 px-4 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 active:bg-white/15 text-[#F7F4EE] text-xs font-semibold transition cursor-pointer disabled:opacity-40",children:"Cancel"}),e.jsx("button",{type:"button",id:"block-modal-confirm-btn",onClick:b,disabled:i,className:`flex-1 h-11 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-md disabled:opacity-60 active:scale-98 ${n?"bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white":"bg-[#C9A96E] hover:bg-[#D8BA80] active:bg-[#B8985C] text-[#0D0D0F]"}`,children:i?e.jsxs(e.Fragment,{children:[e.jsx(g,{size:15,className:"animate-spin"}),e.jsx("span",{children:n?"Blocking...":"Unblocking..."})]}):e.jsx("span",{children:n?"Block":"Unblock"})})]})]})]})})}const x=["javascript:","vbscript:","data:text/html","data:text/javascript","data:application/javascript","file:"];function f(s){if(!s||typeof s!="string")return!1;const t=s.trim();if(!t)return!1;const a=t.toLowerCase();for(const r of x)if(a.startsWith(r))return!1;if(t.startsWith("/"))return!0;try{const o=new URL(t).protocol.toLowerCase();return o==="http:"||o==="https:"||o==="mailto:"||o==="tel:"}catch{return!!t.startsWith("#")}}function P(s,t="#"){return f(s)?s.trim():t}function I(s){if(!s||typeof s!="string")return"";const t=s.trim();if(!t)return"";const a=t.toLowerCase();for(const o of x)if(a.startsWith(o))return"";if(t.startsWith("http://")||t.startsWith("https://"))return f(t)?t:"";const r=`https://${t}`;return f(r)?r:""}export{v as B,$ as C,B as I,F as P,S,D as a,W as b,I as c,P as s};
