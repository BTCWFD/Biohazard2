import File from './file.js'
import H    from '../boot/hex.js'
import node from '../boot/node.js'
import Shader from './shader.js'
import Tim  from './tim.js'
import Tool from './tool.js'

const matrix = node.load('boot/gl-matrix.js');
const {vec3, mat4} = matrix;

const VERTEX_LEN = 2 * 4; 
const NORMAL_LEN = VERTEX_LEN;
const TRI_IDX_LEN = 2 * 6;
const TRI_TEX_LEN = (1+1+2) * 3;
const QUA_IDX_LEN = 2 * 8;
const QUA_TEX_LEN = (1+1+2) * 4;

export default {
  emd,
  pld,
};


class MD {
  constructor() {
    // 动作数组
    this.pose = [];
    // 骨骼绑定状态
    this.bone = [];
    // 用于传输数据到着色器
    this.bind_bone = new Float32Array(20*8);
  }

  //
  // anim_set 是个二维数组[动作索引][帧索引], 值是对骨骼状态的索引
  // get_frame_data(骨骼状态的索引) 可以返回该动作帧上的的全部骨骼数据.
  //
  addAnimSet(anim_set, get_frame_data) {
    let pi = this.pose.length;
    for (let i=0; i<anim_set.length; ++i) {
      this.pose[pi + i] = anim_set[i];
      this.pose[pi + i].get_frame_data = get_frame_data;
    }
  }

  //
  // 返回动作第 frameId 帧上的骨骼数据(skdata)
  //
  getFrameData(poseId, frameId) {
    let frm = this.pose[poseId];
    if (!frm) return;
    let fdata = frm[frameId];
    if (!fdata) return;
    return frm.get_frame_data(fdata.skidx);
  }

  getPose(poseId) {
    return this.pose[poseId];
  }

  poseCount() {
    return this.pose.length;
  }

  transformRoot(alf, sprites, count) {
    this.bone[0].transform2(this.bind_bone, alf, sprites, count);
  }
}


function _open(file) {
  const buf = File.dataViewExt(File.openDataView(file));
  const h_dir_offset = buf.ulong();
  const h_dir_count = buf.ulong();
  buf._offset = _offset;
  debug(file, "DIR", h_dir_count, h_dir_offset);
  return buf;

  function _offset(typeIdx) {
    if (typeIdx >= h_dir_count) {
      throw new Error("Dir Exceeded the maximum", h_dir_count);
    }
    let r = buf.ulong(h_dir_offset + (typeIdx << 2));
    // debug("] OFFSET", Tool.h4(r), 'AT', Tool.h4(h_dir_offset + (typeIdx << 2)));
    return r;
  }
}


function emd(file) {
  const buf = _open(file);
  const md = new MD();
  let am_idx;

  am_idx = animation(buf, buf._offset(1));
  if (am_idx) skeleton(md, am_idx, buf, buf._offset(2));
  
  am_idx = animation(buf, buf._offset(3));
  if (am_idx) skeleton(md, am_idx, buf, buf._offset(4));

  am_idx = animation(buf, buf._offset(5));
  if (am_idx) skeleton(md, am_idx, buf, buf._offset(6));

  md.mesh = mesh(buf, buf._offset(7));
  return md;
}


function pld(file) {
  const buf = _open(file);
  const md = new MD();

  let am_idx = animation(buf, buf._offset(0));
  if (am_idx) skeleton(md, am_idx, buf, buf._offset(1));

  md.mesh = mesh(buf, buf._offset(2));

  let timbuf = new DataView(buf.buffer, buf._offset(3));
  md.tex = Tim.parseStream(timbuf);
  return md;
}


function animation(buf, am_off) {
  // 从第一个元素计算数量
  // const count = buf.ushort(am_off);
  const aoff  = buf.ushort(am_off+2);
  const total = aoff >> 2;
  debug("Anim", total, Tool.h4(am_off));
  if (total <= 0) {
    debug(" > No Anim");
    return;
  }

  const am_idx = [];

  for (let i=0; i<total; ++i) {
    let ec = buf.ushort(am_off + i*4);
    let offset = buf.ushort();
    let group = am_idx[i] = [];
    buf.setpos(am_off + offset);
    debug(' >', i, ec, Tool.h4(am_off + offset));

    for (let j=0; j<ec; ++j) {
      let t = buf.ulong();
      group[j] = {
        flag   : (t & 0xFFFFF800) >> 11,
        sk_idx : (t &      0x7FF),
      };
      // debug('  -', i, j, '\t', group[j].flag, '\t', group[j].sk_idx);
    }
  }
  // debug("Anim count", ret.length);
  return am_idx;
}


class SkeletonBone {
  constructor(dat, i) {
    this.dat = dat;
    this.parent = null;
    this.idx = i;
    this.child = [];
    this._pos = [];
  }


  toString() {
    return JSON.stringify(this.dat);
  }


  //
  // 把骨骼数据(旋转偏移) 传送到着色器
  //
  transform2(bind_bone, alf, sprites, count) {
    // 骨骼索引和3d面组索引对应
    const idx = this.idx;
    alf.index(idx);
    
    let boffset = count << 3;
    bind_bone[0 +boffset] = this.dat.x;
    bind_bone[1 +boffset] = this.dat.y;
    bind_bone[2 +boffset] = this.dat.z;
    bind_bone[3 +boffset] = 1;
    bind_bone[4 +boffset] = alf.x;
    bind_bone[5 +boffset] = alf.y;
    bind_bone[6 +boffset] = alf.z;
    bind_bone[7 +boffset] = alf.w;

    // bind_bone.fill(0);
    Shader.bindBoneOffset(bind_bone, count);
    sprites[idx].draw();

    count++;
    for (let i=0, len=this.child.length; i<len; ++i) {
      this.child[i].transform2(bind_bone, alf, sprites, count);
    }
  }
};


function skeleton(md, am_idx, buf, sk_offset) {
  debug("SK", Tool.h4(sk_offset));
  // buf.print(sk_offset, 500);
  const ref_val     = buf.ushort(sk_offset);
  const anim_val    = buf.ushort();
  const count       = buf.ushort();
  const size        = buf.ushort();
  const ref_offset  = ref_val + sk_offset;
  const anim_offset = anim_val + sk_offset;
  let   xyoff       = sk_offset + 8;

  debug(" * Header", ref_val, anim_val, count, size);
  if (size == 0) {
    debug(" * NO skeleton");
    return;
  }

  if (ref_val > 0) {
    __bone_bind(md, count, xyoff, ref_offset, buf);
  }

  //
  // 生化危机用的是关节骨骼模型, 有一个整体的 xyz 偏移和每个关节的角度.
  // 一个关节的转动会牵连子关节的运动
  //
  let get_frame_data = 
      create_anim_frame_data(buf, anim_offset, size);

  md.addAnimSet(am_idx, get_frame_data);
}


function __bone_bind(md, count, xyoff, ref_offset, buf) {
  // 复用骨骼
  const bone = md.bone;
  const bind = {};

  for (let i=0; i<count; ++i) {
    let sk = { child: [] };
    sk.x = buf.short(xyoff);
    sk.y = buf.short();
    sk.z = buf.short();
    xyoff += 6;

    // 子节点的数量
    let num_mesh = buf.ushort(ref_offset + (i<<2));
    // 子节点引用数组偏移
    let ch_offset = buf.ushort() + ref_offset;
    // debug('ch_offset', ch_offset, ref_offset);
    // 只有骨骼偏移, 复用绑定
    if (num_mesh >= count) {
      debug(" *! No bone bind", i);
      return;
    }

    bone[i] = new SkeletonBone(sk, i);
    for (let m=0; m<num_mesh; ++m) {
      let chref = buf.byte(ch_offset + m);
      sk.child.push(chref);
      bind[chref] = bone[i];
    }
    debug(" ** ", i, sk);
  }

  for (let i=0; i<count; ++i) {
    if (bind[i]) {
      bone[i].parent = bind[i];
      bind[i].child.push(bone[i]);
      // debug(bone[i]);
    }
  }
}


//
// 每个骨骼状态, 保护一组坐标, 一组速度和一组旋转数组,
// 旋转数组用 9 个字节保存2组旋转坐标.
// <防止闭包引用过多变量>
//
function create_anim_frame_data(buf, anim_offset, data_size) {
  const xy_size    = 2*6;
  const angle_size = data_size - xy_size;
  const MAX_ANGLE  = 0x1000;
  const RLEN       = parseInt(angle_size/9*2);
  const skdata     = { angle: [] };
  const PI2        = 2 * Math.PI;
  const angle_fn   = degrees; // radian & degrees
  const OFF_MASK   = 2048; // TODO: 搞清楚偏移的意义
  let curr_sk_idx  = -1;

  if (angle_size <= 0) {
    console.warn("NO more anim frame data");
    return;
  }

  debug(" * Anim angle count", RLEN);
  skdata.angle = new Array(RLEN);
  for (let i=0; i<RLEN; ++i) {
    skdata.angle[i] = {x:0, y:0, z:0};
  }
  
  //
  // sk_index - 骨骼状态索引
  //
  return function get_frame_data(sk_index) {
    // debug(" * Frame sk", sk_index);
    // 没有改变骨骼索引直接返回最后的数据
    if (curr_sk_idx === sk_index) return skdata;
    // 整体位置偏移量, 一个半字节有效
    let xy_off = anim_offset + data_size * sk_index;
    skdata.x = buf.short(xy_off);
    skdata.y = buf.short() + OFF_MASK;
    skdata.z = buf.short();
    // TODO: 动画速度?
    skdata.spx = buf.short();
    skdata.spy = buf.short();
    skdata.spz = buf.short();

    compute_angle();
    // debug(JSON.stringify(skdata), RLEN);
    curr_sk_idx = sk_index;
    return skdata;
  }

  function compute_angle() {
    let i = -1;
    while (++i < RLEN) {
      let r = skdata.angle[i];
      let a0 = buf.byte();
      let a1 = buf.byte();
      let a2 = buf.byte();
      let a3 = buf.byte();
      let a4 = buf.byte();
      // debug('joint', i, a0, a1, a2, a3, a4);
      r.x = angle_fn(a0 + ((a1 & 0xF) << 8));
      r.y = angle_fn((a1 >> 4) + (a2 << 4));
      r.z = angle_fn(a3 + ((a4 & 0xF) << 8));
      // debug(r.x, r.y, r.z);

      if (++i < RLEN) {
        r = skdata.angle[i];
        a0 = a4;
        a1 = buf.byte();
        a2 = buf.byte();
        a3 = buf.byte();
        a4 = buf.byte();
        // debug('joint', i, a0, a1, a2, a3, a4);
        r.x = angle_fn((a0 >> 4) + (a1 << 4));
        r.y = angle_fn(a2 + ((a3 & 0xF) << 8));
        r.z = angle_fn((a3 >> 4) + (a4 << 4));
        // debug(r.x, r.y, r.z);
      } else {
        return;
      }
    }
  }

  // 返回弧度
  function radian(n) {
    return (n/MAX_ANGLE) * PI2;
  }

  // 返回角度
  function degrees(n) {
    return (n/MAX_ANGLE) * 360;
  }
}


function mesh(buf, offset) {
  const length = buf.ulong(offset);
  const uk = buf.ulong(offset + 4);
  const obj_count = buf.ulong(offset + 8) >> 1;
  const meshObj = [];
  const beginAt = buf.getpos();
  offset += 3 * 4;
  debug('MESH', Tool.h4(beginAt), 'count', obj_count, length, uk);

  let o, c;

  // TODO: 艾达的面分配错误
  for (let i=0; i<obj_count; ++i) {
    // 三角形 index_offset 为顶点索引, tex 数量与 index 数量相同
    let tri = {};
    o = buf.ulong(offset) + beginAt;
    c = buf.ulong();
    tri.vertex = buildBuffer(Int16Array, o, c, VERTEX_LEN);

    o = buf.ulong() + beginAt;
    c = buf.ulong();
    tri.normal = buildBuffer(Int16Array, o, c, NORMAL_LEN);

    o = buf.ulong() + beginAt;
    c = buf.ulong();
    tri.index = buildBuffer(Uint16Array, o, c, TRI_IDX_LEN);

    o = buf.ulong() + beginAt;
    tri.tex = buildBuffer(Uint8Array, o, c, TRI_TEX_LEN);
    debug(' % T end', i, tri.vertex.count, Tool.h4(tri.vertex.offset));

    // 四边形
    let qua = {};
    o = buf.ulong() + beginAt;
    c = buf.ulong();
    qua.vertex = buildBuffer(Int16Array, o, c, VERTEX_LEN);

    o = buf.ulong() + beginAt;
    c = buf.ulong();
    qua.normal = buildBuffer(Int16Array, o, c, NORMAL_LEN);

    o = buf.ulong() + beginAt;
    c = buf.ulong();
    qua.index = buildBuffer(Uint16Array, o, c, QUA_IDX_LEN);

    o = buf.ulong() + beginAt;
    qua.tex = buildBuffer(Uint8Array, o, c, QUA_TEX_LEN);
    debug(' % Q end', i, qua.vertex.count, Tool.h4(qua.vertex.offset));

    offset += 56;
    meshObj.push({ tri, qua });
  }

  function buildBuffer(T, offset, count, stride) {
    // console.debug(" % BUFFER", count, stride, 'AT:', Tool.h4(offset));
    return {
      // 缓冲区
      buf : buf.build(T, offset, count * stride),
      // 元素数量
      count,
      // 单个元素长度/元素间隔, 字节
      stride,
      offset,
    };
  }

  return meshObj;
}


function debug() {
  // Tool.debug.apply(null, arguments);
}