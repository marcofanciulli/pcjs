/**
 * @fileoverview Implements the PDP11 Bus component.
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @copyright © Jeff Parsons 2012-2016
 *
 * This file is part of PCjs, a computer emulation software project at <http://pcjs.org/>.
 *
 * It has been adapted from the JavaScript PDP 11/70 Emulator v1.4 written by Paul Nankervis
 * (paulnank@hotmail.com) as of September 2016 at <http://skn.noip.me/pdp11/pdp11.html>.  This code
 * may be used freely provided the original authors are acknowledged in any modified source code.
 *
 * PCjs is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * PCjs is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with PCjs.  If not,
 * see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every modified copy of this work
 * and to display that copyright notice when the software starts running; see COPYRIGHT in
 * <http://pcjs.org/modules/shared/lib/defines.js>.
 *
 * Some PCjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of PCjs
 * for purposes of the GNU General Public License, and the author does not claim any copyright
 * as to their contents.
 */

"use strict";

if (NODE) {
    var str           = require("../../shared/lib/strlib");
    var usr           = require("../../shared/lib/usrlib");
    var Component     = require("../../shared/lib/component");
    var State         = require("../../shared/lib/state");
    var MemoryPDP11   = require("./memory");
    var MessagesPDP11 = require("./messages");
}

/**
 * BusPDP11(parmsBus, cpu, dbg)
 *
 * The BusPDP11 component manages physical memory and I/O address spaces.
 *
 * The BusPDP11 component has no UI elements, so it does not require an init() handler,
 * but it still inherits from the Component class and must be allocated like any
 * other device component.  It's currently allocated by the Computer's init() handler,
 * which then calls the initBus() method of all the other components.
 *
 * For memory beyond the simple needs of the ROM and RAM components (ie, memory-mapped
 * devices), the address space must still be allocated through the BusPDP11 component via
 * addMemory().  If the component needs something more than simple read/write storage,
 * it must provide a custom controller.
 *
 * @constructor
 * @extends Component
 * @param {Object} parmsBus
 * @param {CPUStatePDP11} cpu
 * @param {DebuggerPDP11} dbg
 */
function BusPDP11(parmsBus, cpu, dbg)
{
    Component.call(this, "Bus", parmsBus, BusPDP11, MessagesPDP11.BUS);

    this.cpu = cpu;
    this.dbg = dbg;

    /*
     * Supported values for nBusWidth are 16 (default), 18, and 22.  This represents the maximum size
     * of the bus for the life of the machine, regardless what memory management mode the CPU has enabled.
     */
    this.nBusWidth = parmsBus['busWidth'] || 16;

    /*
     * This controls the location of the IOPAGE (ie, at the top of 16-bit, 18-bit, or 22-bit address range).
     * It is managed by setIOPageRange().  reset() establishes the default (16).
     */
    this.nIOPageRange = 0;                  // zero means no IOPAGE access (yet)
    this.prevIOPageBlocks = [];             // this saves any memory blocks we had to replace with IOPAGE blocks
    this.realIOPageBlocks = null;           // this saves the memory blocks allocated for IOPAGE, so we can reuse them

    /*
     * Compute all BusPDP11 memory block parameters, based on the width of the bus.  The entire
     * address space is divided into blocks, using a block size that is (hopefully) appropriate to
     * the bus width.  The following table summarizes our (original) simplistic calculations:
     *
     *      Bus Width                       Block Shift     Block Size
     *      ---------                       -----------     ----------
     *      16 bits (64Kb address space):   10              1Kb (64 maximum blocks)
     *      18 bits (256Kb address space):  11              2Kb (128 maximum blocks)
     *      20 bits (1Mb address space):    12              4Kb (256 maximum blocks)
     *      22 bits (4Mb address space):    13              8Kb (512 maximum blocks)
     *      24 bits (16Mb address space):   14              16Kb (1K maximum blocks)
     *      32 bits (4Gb address space);    15              32Kb (128K maximum blocks)
     *
     * The coarser block granularities (ie, 16Kb and 32Kb) may cause problems for certain RAM and/or ROM
     * allocations that are contiguous but are allocated out of order, or that have different controller
     * requirements.  Your choices, for the moment, are either to ensure the allocations are performed in
     * order, or to choose smaller nBlockShift values (at the expense of a generating a larger block array).
     */
    this.addrTotal = Math.pow(2, this.nBusWidth);
    this.nBusLimit = this.nBusMask = (this.addrTotal - 1) | 0;

    /*
     * WARNING: Instead of dynamically calculating nBlockShift based on nBusWidth, as described above, we
     * now force nBlockSize to IOPAGE_LENGTH, because that's what our IOController functions currently assume.
     *
     *      this.nBlockShift = (this.nBusWidth >> 1) + 2;
     *      if (this.nBlockShift < 10) this.nBlockShift = 10;
     *      if (this.nBlockShift > 15) this.nBlockShift = 15;
     *      this.nBlockSize = 1 << this.nBlockShift;
     */
    this.nBlockSize = BusPDP11.IOPAGE_LENGTH;
    this.nBlockShift = Math.log2(this.nBlockSize);      // ES6 ALERT (alternatively: Math.log(this.nBlockSize) / Math.LN2)

    this.nBlockLen = this.nBlockSize >> 2;
    this.nBlockLimit = this.nBlockSize - 1;
    this.nBlockTotal = (this.addrTotal / this.nBlockSize) | 0;
    this.nBlockMask = this.nBlockTotal - 1;
    this.assert(this.nBlockMask <= BusPDP11.BlockInfo.num.mask);

    /*
     * aIOHandlers is an array (ie, a hash) of I/O notification handlers, indexed by address, where each
     * entry contains an array:
     *
     *      [0]: readByte(addr)
     *      [1]: writeByte(b, addr)
     *      [2]: readWord(addr)
     *      [3]: writeWord(w, addr)
     *
     * Each of these 4-element arrays are similar to the memory access arrays assigned to entire Memory
     * blocks, but these handlers generally target a specific address (or handful of addresses), while
     * Memory access handlers must service the entire block; see the setAccess() function in the Memory
     * component for details.
     *
     * Finally, for debugging purposes, if an I/O address has a symbolic name, it will be saved here:
     *
     *      [4]: symbolic name of I/O address
     *
     * UPDATE: The Debugger wants to piggy-back on these arrays to indicate addresses for which it wants
     * notification.  In those cases, the following additional element will be set:
     *
     *      [5]: true to break on I/O, false to ignore I/O
     *
     * The false case is important if fIOBreakAll is set, because it allows the Debugger to selectively
     * ignore specific addresses.
     */
    this.aIOHandlers = [];
    this.fIOBreakAll = false;
    this.nDisableFaults = 0;

    /*
     * Array of RESET notification handlers registered by Device components.
     */
    this.afnReset = [];

    /*
     * Before we can add any memory blocks that declare our component as a custom memory controller,
     * we must initialize the array that the getControllerAccess() method supplies to the Memory component.
     */
    this.afnIOPage = [
        BusPDP11.IOController.readByte,
        BusPDP11.IOController.writeByte,
        BusPDP11.IOController.readWord,
        BusPDP11.IOController.writeWord
    ];

    /*
     * We're ready to allocate empty Memory blocks to span the entire physical address space, including the
     * initial location of the IOPAGE.
     */
    this.initMemory();

    this.setReady();
}

Component.subclass(BusPDP11);

BusPDP11.IOPAGE_16BIT   =   0xE000; /*000160000*/               // eg, PDP-11/20
BusPDP11.IOPAGE_18BIT   =  0x3E000; /*000760000*/               // eg, PDP-11/45
BusPDP11.IOPAGE_UNIBUS  = 0x3C0000; /*017000000*/
BusPDP11.IOPAGE_22BIT   = 0x3FE000; /*017760000*/               // eg, PDP-11/70
BusPDP11.IOPAGE_LENGTH  =   0x2000;                             // ie, 8Kb
BusPDP11.IOPAGE_MASK    = BusPDP11.IOPAGE_LENGTH - 1;
BusPDP11.MAX_MEMORY     = BusPDP11.IOPAGE_UNIBUS - 16384;       // Maximum memory address (need less memory for BSD 2.9 boot)

BusPDP11.ERROR = {
    RANGE_INUSE:        1,
    RANGE_INVALID:      2,
    NO_CONTROLLER:      3
};

/*
 * Every entry in the aIOHandlers table is an array with the following indexes:
 */
BusPDP11.IOHANDLER = {
    READ_BYTE:          0,
    WRITE_BYTE:         1,
    READ_WORD:          2,
    WRITE_WORD:         3,
    NAME:               4
};

/*
 * These are our custom IOController functions for all IOPAGE accesses.  They look up the IOPAGE
 * offset in the aIOHandlers table, and if an entry exists, they use the appropriate IOHANDLER indexes
 * (above) to locate the registered read/write handlers.  If no handler is found, then unknownAccess()
 * is called, triggering a trap -- unless traps are disabled because direct access was requested
 * (eg, by the Debugger).
 *
 * Handlers receive the original IOPAGE address that was used, although in most cases, it's ignored,
 * because most handlers usually handle only one address.  Only handlers used for a range of addresses
 * must pay attention to it.
 *
 * Note that these functions include fallbacks for byte reads when only word read handlers exist (by
 * masking or shifting the result) and for word reads if only byte handlers exist (by combining bytes).
 * Fallbacks for writes exist, too, but they are slightly more complicated, because a byte write using
 * a word write handler requires reading the word first, and then updating the appropriate byte within
 * that word.
 *
 * Those fallbacks may not always be appropriate; for example, byte writes to some device registers
 * must be zero-extended to update the entire word.  For those cases, the fallback's "preliminary" read
 * is issued with a zero address so that the handler can distinguish a normal read from one of these
 * preliminary reads (aka read-before-write), and return an appropriate value for the update (eg, zero).
 *
 * If none of these fallback behaviors are appropriate, the device has a simple recourse: register
 * handlers for all possible addresses and sizes.
 *
 * Unlike regular Memory blocks, IOPAGE accesses permit word accesses on ODD addresses; that works
 * just fine by registering WORD handlers for the appropriate ODD addresses.  For BYTE accesses, it
 * depends.  For CPU register addresses, addIOHandlers() installs special byte handlers that perform
 * either a simple word read or write.  Other addresses must be handled on case-by-case basis.
 *
 * TODO: Another small potential improvement would be for addIOHandlers() to install fallbacks for ALL
 * missing handlers, in both the ODD and EVEN cases, so there's never a need to check each function index
 * before calling it.  However, since there's no avoiding checking aIOHandlers[off] (unless we FULLY populate
 * the aIOHandlers array), and since these I/O accesses should be pretty infrequent relative to all other
 * memory accesses, the benefit seems pretty minimal.  Plus, all our fallback assumptions still need to be
 * verified, so let's wait until that's done before we start optimizing this code.
 */
BusPDP11.IOController = {

    /**
     * readByte(off, addr)
     *
     * @this {MemoryPDP11}
     * @param {number} off
     * @param {number} addr
     * @return {number}
     */
    readByte: function(off, addr)
    {
        var b = -1;
        var bus = this.controller;
        var afn = bus.aIOHandlers[off];
        if (afn) {
            if (afn[BusPDP11.IOHANDLER.READ_BYTE]) {
                b = afn[BusPDP11.IOHANDLER.READ_BYTE](addr);
            } else if (afn[BusPDP11.IOHANDLER.READ_WORD]) {
                if (!(addr & 0x1)) {
                    b = afn[BusPDP11.IOHANDLER.READ_WORD](addr) & 0xff;
                } else {
                    b = afn[BusPDP11.IOHANDLER.READ_WORD](addr & ~0x1) >> 8;
                }
            }
        } else if (addr & 0x1) {
            afn = bus.aIOHandlers[off & ~0x1];
            if (afn) {
                if (afn[BusPDP11.IOHANDLER.READ_WORD]) {
                    b = afn[BusPDP11.IOHANDLER.READ_WORD](addr & ~0x1) >> 8;
                }
            }
        }
        if (b >= 0) {
            if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
                this.dbg.printMessage(afn[BusPDP11.IOHANDLER.NAME] + ".readByte(" + this.dbg.toStrBase(addr) + "): " + this.dbg.toStrBase(b), true, true);
            }
            return b;
        }
        b = bus.unknownAccess(addr, true);
        if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
            this.dbg.printMessage("warning: unconverted read access to byte @" + this.dbg.toStrBase(addr) + ": " + this.dbg.toStrBase(b), true, true);
        }
        return b;
    },

    /**
     * writeByte(off, b, addr)
     *
     * @this {MemoryPDP11}
     * @param {number} off
     * @param {number} b (which should already be pre-masked to 8 bits)
     * @param {number} addr
     */
    writeByte: function(off, b, addr)
    {
        var w;
        var fWrite = false;
        var bus = this.controller;
        var afn = bus.aIOHandlers[off];
        if (afn) {
            /*
             * If a writeByte() handler exists, call it; we're done.
             */
            if (afn[BusPDP11.IOHANDLER.WRITE_BYTE]) {
                afn[BusPDP11.IOHANDLER.WRITE_BYTE](b, addr);
                fWrite = true;
            }
            /*
             * If a writeWord() handler exists, call the readWord() handler first to get the original data,
             * then call writeWord() with the new data pre-inserted in the original data.
             *
             * WARNING: Whenever we call readWord() under these circumstances, we zero the address parameter,
             * so that the handler can distinguish this case.  Thus, if we're dealing with a special register
             * where a byte write operation modifies the entire register, the handler can simply return zero.
             */
            else if (afn[BusPDP11.IOHANDLER.WRITE_WORD]) {
                w = afn[BusPDP11.IOHANDLER.READ_WORD]? afn[BusPDP11.IOHANDLER.READ_WORD](0) : 0;
                if (!(addr & 0x1)) {
                    afn[BusPDP11.IOHANDLER.WRITE_WORD]((w & ~0xff) | b, addr);
                    fWrite = true;
                } else {
                    afn[BusPDP11.IOHANDLER.WRITE_WORD]((w & 0xff) | (b << 8), addr & ~0x1);
                    fWrite = true;
                }
            }
        } else if (addr & 0x1) {
            /*
             * If no handler existed, and this address was odd, then perhaps a handler exists for the even address;
             * if so, call the readWord() handler first to get the original data, then call writeWord() with the new
             * data pre-inserted in (the high byte of) the original data.
             *
             * WARNING: Whenever we call readWord() under these circumstances, we zero the address parameter,
             * so that the handler can distinguish this case.  Thus, if we're dealing with a special register
             * where a byte write operation modifies the entire register, the handler can simply return zero.
             */
            afn = bus.aIOHandlers[off & ~0x1];
            if (afn) {
                if (afn[BusPDP11.IOHANDLER.WRITE_WORD]) {
                    addr &= ~0x1;
                    w = afn[BusPDP11.IOHANDLER.READ_WORD]? afn[BusPDP11.IOHANDLER.READ_WORD](0) : 0;
                    afn[BusPDP11.IOHANDLER.WRITE_WORD]((w & 0xff) | (b << 8), addr);
                    fWrite = true;
                }
            }
        }
        if (fWrite) {
            if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
                this.dbg.printMessage(afn[BusPDP11.IOHANDLER.NAME] + ".writeByte(" + this.dbg.toStrBase(addr) + "," + this.dbg.toStrBase(b) + ")", true, true);
            }
            return;
        }
        bus.unknownAccess(addr, true, b);
        if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
            this.dbg.printMessage("warning: unconverted write access to byte @" + this.dbg.toStrBase(addr) + ": " + this.dbg.toStrBase(b), true, true);
        }
    },

    /**
     * readWord(off, addr)
     *
     * @this {MemoryPDP11}
     * @param {number} off
     * @param {number} addr
     * @return {number}
     */
    readWord: function(off, addr)
    {
        var w = -1;
        var bus = this.controller;
        var afn = bus.aIOHandlers[off];
        if (afn) {
            if (afn[BusPDP11.IOHANDLER.READ_WORD]) {
                w = afn[BusPDP11.IOHANDLER.READ_WORD](addr);
            } else if (afn[BusPDP11.IOHANDLER.READ_BYTE]) {
                w = afn[BusPDP11.IOHANDLER.READ_BYTE](addr) | (afn[BusPDP11.IOHANDLER.READ_BYTE](addr + 1) << 8);
            }
        }
        if (w >= 0) {
            if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
                this.dbg.printMessage(afn[BusPDP11.IOHANDLER.NAME] + ".readWord(" + this.dbg.toStrBase(addr) + "): " + this.dbg.toStrBase(w), true, true);
            }
            return w;
        }
        w = bus.unknownAccess(addr, false);
        if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
            this.dbg.printMessage("warning: unconverted read access to word @" + this.dbg.toStrBase(addr) + ": " + this.dbg.toStrBase(w), true, true);
        }
        return w;
    },

    /**
     * writeWord(off, w, addr)
     *
     * @this {MemoryPDP11}
     * @param {number} off
     * @param {number} w (which should already be pre-masked to 16 bits)
     * @param {number} addr
     */
    writeWord: function(off, w, addr)
    {
        var fWrite = false;
        var bus = this.controller;
        var afn = bus.aIOHandlers[off];
        if (afn) {
            if (afn[BusPDP11.IOHANDLER.WRITE_WORD]) {
                afn[BusPDP11.IOHANDLER.WRITE_WORD](w, addr);
                fWrite = true;
            } else if (afn[BusPDP11.IOHANDLER.WRITE_BYTE]) {
                afn[BusPDP11.IOHANDLER.WRITE_BYTE](w & 0xff, addr);
                afn[BusPDP11.IOHANDLER.WRITE_BYTE](w >> 8, addr + 1);
                fWrite = true;
            }
        }
        if (fWrite) {
            if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
                this.dbg.printMessage(afn[BusPDP11.IOHANDLER.NAME] + ".writeWord(" + this.dbg.toStrBase(addr) + "," + this.dbg.toStrBase(w) + ")", true, true);
            }
            return;
        }
        bus.unknownAccess(addr, false, w);
        if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
            this.dbg.printMessage("warning: unconverted write access to word @" + this.dbg.toStrBase(addr) + ": " + this.dbg.toStrBase(w), true, true);
        }
    }
};

/**
 * initMemory()
 *
 * Allocate enough (empty) Memory blocks to span the entire physical address space.
 *
 * @this {BusPDP11}
 */
BusPDP11.prototype.initMemory = function()
{
    var block = new MemoryPDP11(this);
    block.copyBreakpoints(this.dbg);
    this.aMemBlocks = new Array(this.nBlockTotal);
    for (var iBlock = 0; iBlock < this.nBlockTotal; iBlock++) {
        this.aMemBlocks[iBlock] = block;
    }
};

/**
 * setIOPageRange(nRange)
 *
 * We can define the IOPAGE address range with a single number, because the size of the IOPAGE is fixed at 8Kb.
 * The bottom of the range is (2 ^ nRange) - IOPAGE_LENGTH, and the top is (2 ^ nRange) - 1.
 *
 * Note that we defer our initial call to this function as long as possible (ie, at the end of reset()) so that
 * other components have first shot at adding their own memory blocks (if any), because addMemory() only allows
 * installing memory on top of empty memory blocks.
 *
 * @this {BusPDP11}
 * @param {number} nRange (16, 18 or 22; 0 removes the IOPAGE altogether)
 */
BusPDP11.prototype.setIOPageRange = function(nRange)
{
    if (nRange != this.nIOPageRange) {
        var addr;
        if (this.nIOPageRange) {
            addr = (1 << this.nIOPageRange) - BusPDP11.IOPAGE_LENGTH;
            this.setMemoryBlocks(addr, BusPDP11.IOPAGE_LENGTH, this.prevIOPageBlocks);
            this.nIOPageRange = 0;
        }
        if (nRange) {
            this.nIOPageRange = nRange;
            addr = (1 << nRange) - BusPDP11.IOPAGE_LENGTH;
            this.prevIOPageBlocks = this.getMemoryBlocks(addr, BusPDP11.IOPAGE_LENGTH);
            if (this.realIOPageBlocks) {
                this.setMemoryBlocks(addr, BusPDP11.IOPAGE_LENGTH, this.realIOPageBlocks);
            } else {
                this.addMemory(addr, BusPDP11.IOPAGE_LENGTH, MemoryPDP11.TYPE.CONTROLLER, this);
                this.realIOPageBlocks = this.getMemoryBlocks(addr, BusPDP11.IOPAGE_LENGTH);
            }
        }
    }
};

/**
 * getControllerBuffer(addr)
 *
 * Our Bus component also acts as custom memory controller for the IOPAGE, so it must also provide this function.
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @return {Array} containing the buffer (and the offset within that buffer that corresponds to the requested block)
 */
BusPDP11.prototype.getControllerBuffer = function(addr)
{
    /*
     * No buffer is required for the IOPAGE; all accesses go to registered I/O handlers or to unknownAccess().
     */
    return [null, 0];
};

/**
 * getControllerAccess()
 *
 * Our Bus component also acts as custom memory controller for the IOPAGE, so it must also provide this function.
 *
 * @this {BusPDP11}
 * @return {Array.<function()>}
 */
BusPDP11.prototype.getControllerAccess = function()
{
    return this.afnIOPage;
};

/**
 * getWidth()
 *
 * @this {BusPDP11}
 * @return {number}
 */
BusPDP11.prototype.getWidth = function()
{
    return this.nBusWidth;
};

/**
 * reset()
 *
 * Call all registered reset() handlers.
 *
 * @this {BusPDP11}
 */
BusPDP11.prototype.reset = function()
{
    for (var i = 0; i < this.afnReset.length; i++) {
        this.afnReset[i]();
    }
    this.setIOPageRange(16);
};

/**
 * unknownAccess(addr, fByte, data)
 *
 * This is our default I/O handler, called when there's an IOPAGE access without a corresponding entry in aIOHandlers.
 *
 * @this {BusPDP11}
 * @param {number} addr (ie, an IOPAGE address)
 * @param {boolean} [fByte] (true if byte access, otherwise word)
 * @param {number} [data] (undefined if read, otherwise write)
 * @return {number}
 */
BusPDP11.prototype.unknownAccess = function(addr, fByte, data)
{
    if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.WARN)) {
        /*
         * TODO: For 22-bit machines, let's display addr as a 3-byte value (for a total of 9 octal digits)
         */
        this.dbg.printMessage("warning: unknown I/O access (" + this.dbg.toStrBase(addr) + "," + this.dbg.toStrBase(data, fByte?1:2) + ")", true, true);
        this.dbg.stopInstruction();
    }
    if (!this.nDisableFaults) {
        this.cpu.trap(PDP11.TRAP.BUS_ERROR, addr);
    }
    return 0;
};

/**
 * powerUp(data, fRepower)
 *
 * We don't need a powerDown() handler, because for largely historical reasons, our state is saved by saveMemory(),
 * which called by the CPU.
 *
 * However, we do need a powerUp() handler, because on resumable machines, the Computer's onReset() function calls
 * everyone's powerUp() handler rather than their reset() handler.
 *
 * TODO: Perhaps Computer should be smarter: if there's no powerUp() handler, then fallback to the reset() handler.
 * In that case, however, we'd either need to remove the powerUp() stub in Component, or detect the existence of the stub.
 *
 * @this {BusPDP11}
 * @param {Object|null} data (always null because we supply no powerDown() handler)
 * @param {boolean} [fRepower]
 * @return {boolean} true if successful, false if failure
 */
BusPDP11.prototype.powerUp = function(data, fRepower)
{
    if (!fRepower) this.reset();
    return true;
};

/**
 * addMemory(addr, size, type, controller)
 *
 * Adds new Memory blocks to the specified address range.  Any Memory blocks previously
 * added to that range must first be removed via removeMemory(); otherwise, you'll get
 * an allocation conflict error.  This helps prevent address calculation errors, redundant
 * allocations, etc.
 *
 * We've relaxed some of the original requirements (ie, that addresses must start at a
 * block-granular address, or that sizes must be equal to exactly one or more blocks),
 * because machines with large block sizes can make it impossible to load certain ROMs at
 * their required addresses.  Every allocation still allocates a whole number of blocks.
 *
 * Even so, BusPDP11 memory management does NOT provide a general-purpose heap.  Most memory
 * allocations occur during machine initialization and never change.  In particular, there
 * is NO support for removing partial-block allocations.
 *
 * Each Memory block keeps track of a start address (addr) and length (used), indicating
 * the used space within the block; any free space that precedes or follows that used space
 * can be allocated later, by simply extending the beginning or ending of the previously used
 * space.  However, any holes that might have existed between the original allocation and an
 * extension are subsumed by the extension.
 *
 * @this {BusPDP11}
 * @param {number} addr is the starting physical address of the request
 * @param {number} size of the request, in bytes
 * @param {number} type is one of the MemoryPDP11.TYPE constants
 * @param {Object} [controller] is an optional memory controller component
 * @return {boolean} true if successful, false if not
 */
BusPDP11.prototype.addMemory = function(addr, size, type, controller)
{
    var addrNext = addr;
    var sizeLeft = size;
    var iBlock = addrNext >>> this.nBlockShift;

    while (sizeLeft > 0 && iBlock < this.aMemBlocks.length) {

        var block = this.aMemBlocks[iBlock];
        var addrBlock = iBlock * this.nBlockSize;
        var sizeBlock = this.nBlockSize - (addrNext - addrBlock);
        if (sizeBlock > sizeLeft) sizeBlock = sizeLeft;

        /*
         * addMemory() will now happily replace an existing block when a memory controller is specified;
         * this is a work-around to make life easier for setIOPageRange(), which otherwise would have to call
         * removeMemory() first, which would just waste time and memory allocating more (empty) blocks.
         */
        if (!controller && block && block.size) {
            if (block.type == type /* && block.controller == controller */) {
                /*
                 * Where there is already a similar block with a non-zero size, we allow the allocation only if:
                 *
                 *   1) addrNext + sizeLeft <= block.addr (the request precedes the used portion of the current block), or
                 *   2) addrNext >= block.addr + block.used (the request follows the used portion of the current block)
                 */
                if (addrNext + sizeLeft <= block.addr) {
                    block.used += (block.addr - addrNext);
                    block.addr = addrNext;
                    return true;
                }
                if (addrNext >= block.addr + block.used) {
                    var sizeAvail = block.size - (addrNext - addrBlock);
                    if (sizeAvail > sizeLeft) sizeAvail = sizeLeft;
                    block.used = addrNext - block.addr + sizeAvail;
                    addrNext = addrBlock + this.nBlockSize;
                    sizeLeft -= sizeAvail;
                    iBlock++;
                    continue;
                }
            }
            return this.reportError(BusPDP11.ERROR.RANGE_INUSE, addrNext, sizeLeft);
        }

        var blockNew = new MemoryPDP11(this, addrNext, sizeBlock, this.nBlockSize, type, controller);
        blockNew.copyBreakpoints(this.dbg, block);
        this.aMemBlocks[iBlock++] = blockNew;

        addrNext = addrBlock + this.nBlockSize;
        sizeLeft -= sizeBlock;
    }

    if (sizeLeft <= 0) {
        this.status(str.toDec(size / 1024) + "Kb " + MemoryPDP11.TYPE_NAMES[type] + " at " + str.toOct(addr));
        return true;
    }

    return this.reportError(BusPDP11.ERROR.RANGE_INVALID, addr, size);
};

/**
 * cleanMemory(addr, size)
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @param {number} size
 * @return {boolean} true if all blocks were clean, false if dirty; all blocks are cleaned in the process
 */
BusPDP11.prototype.cleanMemory = function(addr, size)
{
    var fClean = true;
    var iBlock = addr >>> this.nBlockShift;
    while (size > 0 && iBlock < this.aMemBlocks.length) {
        if (this.aMemBlocks[iBlock].fDirty) {
            this.aMemBlocks[iBlock].fDirty = fClean = false;
            this.aMemBlocks[iBlock].fDirtyEver = true;
        }
        size -= this.nBlockSize;
        iBlock++;
    }
    return fClean;
};

/**
 * zeroMemory(addr, size)
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @param {number} size
 */
BusPDP11.prototype.zeroMemory = function(addr, size)
{
    var off = addr & this.nBlockLimit;
    var iBlock = addr >>> this.nBlockShift;
    while (size > 0 && iBlock < this.aMemBlocks.length) {
        this.aMemBlocks[iBlock].zero(off, size);
        size -= this.nBlockSize;
        iBlock++;
        off = 0;
    }
};

/*
 * Data types used by scanMemory()
 */

/**
 * @typedef {number} BlockInfo
 */
var BlockInfo;

/**
 * This defines the BlockInfo bit fields used by scanMemory() when it creates the aBlocks array.
 *
 * @typedef {{
 *  num:    BitField,
 *  count:  BitField,
 *  btmod:  BitField,
 *  type:   BitField
 * }}
 */
BusPDP11.BlockInfo = usr.defineBitFields({num:20, count:8, btmod:1, type:3});

/**
 * BusInfoPDP11 object definition (returned by scanMemory())
 *
 *  cbTotal:    total bytes allocated
 *  cBlocks:    total Memory blocks allocated
 *  aBlocks:    array of allocated Memory block numbers
 *
 * @typedef {{
 *  cbTotal:    number,
 *  cBlocks:    number,
 *  aBlocks:    Array.<BlockInfo>
 * }} BusInfoPDP11
 */
var BusInfoPDP11;

/**
 * scanMemory(info, addr, size)
 *
 * Returns a BusInfoPDP11 object for the specified address range.
 *
 * @this {BusPDP11}
 * @param {BusInfoPDP11} [info] previous BusInfoPDP11, if any
 * @param {number} [addr] starting address of range (0 if none provided)
 * @param {number} [size] size of range, in bytes (up to end of address space if none provided)
 * @return {BusInfoPDP11} updated info (or new info if no previous info provided)
 */
BusPDP11.prototype.scanMemory = function(info, addr, size)
{
    if (addr == null) addr = 0;
    if (size == null) size = (this.addrTotal - addr) | 0;
    if (info == null) info = {cbTotal: 0, cBlocks: 0, aBlocks: []};

    var iBlock = addr >>> this.nBlockShift;
    var iBlockMax = ((addr + size - 1) >>> this.nBlockShift);

    info.cbTotal = 0;
    info.cBlocks = 0;
    while (iBlock <= iBlockMax) {
        var block = this.aMemBlocks[iBlock];
        info.cbTotal += block.size;
        if (block.size) {
            info.aBlocks.push(usr.initBitFields(BusPDP11.BlockInfo, iBlock, 0, 0, block.type));
            info.cBlocks++
        }
        iBlock++;
    }
    return info;
};

/**
 * removeMemory(addr, size)
 *
 * Replaces every block in the specified address range with empty Memory blocks that ignore all reads/writes.
 *
 * TODO: Update the removeMemory() interface to reflect the relaxed requirements of the addMemory() interface.
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @param {number} size
 * @return {boolean} true if successful, false if not
 */
BusPDP11.prototype.removeMemory = function(addr, size)
{
    if (!(addr & this.nBlockLimit) && size && !(size & this.nBlockLimit)) {
        var iBlock = addr >>> this.nBlockShift;
        while (size > 0) {
            var blockOld = this.aMemBlocks[iBlock];
            var blockNew = new MemoryPDP11(this, addr);
            blockNew.copyBreakpoints(this.dbg, blockOld);
            this.aMemBlocks[iBlock++] = blockNew;
            addr = iBlock * this.nBlockSize;
            size -= this.nBlockSize;
        }
        return true;
    }
    return this.reportError(BusPDP11.ERROR.RANGE_INVALID, addr, size);
};

/**
 * getMemoryBlocks(addr, size)
 *
 * @this {BusPDP11}
 * @param {number} addr is the starting physical address
 * @param {number} size of the request, in bytes
 * @return {Array} of Memory blocks
 */
BusPDP11.prototype.getMemoryBlocks = function(addr, size)
{
    var aBlocks = [];
    var iBlock = addr >>> this.nBlockShift;
    while (size > 0 && iBlock < this.aMemBlocks.length) {
        aBlocks.push(this.aMemBlocks[iBlock++]);
        size -= this.nBlockSize;
    }
    return aBlocks;
};

/**
 * setMemoryAccess(addr, size, afn, fQuiet)
 *
 * Updates the access functions in every block of the specified address range.  Since the only components
 * that should be dynamically modifying the memory access functions are those that use addMemory() with a custom
 * memory controller, we require that the block(s) being updated do in fact have a controller.
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @param {number} size
 * @param {Array.<function()>} [afn]
 * @param {boolean} [fQuiet] (true if any error should be quietly logged)
 * @return {boolean} true if successful, false if not
 */
BusPDP11.prototype.setMemoryAccess = function(addr, size, afn, fQuiet)
{
    if (!(addr & this.nBlockLimit) && size && !(size & this.nBlockLimit)) {
        var iBlock = addr >>> this.nBlockShift;
        while (size > 0) {
            var block = this.aMemBlocks[iBlock];
            if (!block.controller) {
                return this.reportError(BusPDP11.ERROR.NO_CONTROLLER, addr, size, fQuiet);
            }
            block.setAccess(afn, true);
            size -= this.nBlockSize;
            iBlock++;
        }
        return true;
    }
    return this.reportError(BusPDP11.ERROR.RANGE_INVALID, addr, size);
};

/**
 * setMemoryBlocks(addr, size, aBlocks, type)
 *
 * If no type is specified, then specified address range uses all the provided blocks as-is;
 * this form of setMemoryBlocks() is used for complete physical aliases.
 *
 * Otherwise, new blocks are allocated with the specified type; the underlying memory from the
 * provided blocks is still used, but the new blocks may have different access to that memory.
 *
 * @this {BusPDP11}
 * @param {number} addr is the starting physical address
 * @param {number} size of the request, in bytes
 * @param {Array} aBlocks as returned by getMemoryBlocks()
 * @param {number} [type] is one of the MemoryPDP11.TYPE constants
 */
BusPDP11.prototype.setMemoryBlocks = function(addr, size, aBlocks, type)
{
    var i = 0;
    var iBlock = addr >>> this.nBlockShift;
    while (size > 0 && iBlock < this.aMemBlocks.length) {
        var block = aBlocks[i++];
        this.assert(block);
        if (!block) break;
        if (type !== undefined) {
            var blockNew = new MemoryPDP11(this, addr);
            blockNew.clone(block, type, this.dbg);
            block = blockNew;
        }
        this.aMemBlocks[iBlock++] = block;
        size -= this.nBlockSize;
    }
};

/**
 * getByte(addr)
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @return {number} byte (8-bit) value at that address
 */
BusPDP11.prototype.getByte = function(addr)
{
    return this.aMemBlocks[(addr & this.nBusMask) >>> this.nBlockShift].readByte(addr & this.nBlockLimit, addr);
};

/**
 * getByteDirect(addr)
 *
 * This is useful for the Debugger and other components that want to bypass getByte() breakpoint detection.
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @return {number} byte (8-bit) value at that address
 */
BusPDP11.prototype.getByteDirect = function(addr)
{
    this.nDisableFaults++;
    var b = this.aMemBlocks[(addr & this.nBusMask) >>> this.nBlockShift].readByteDirect(addr & this.nBlockLimit, addr);
    this.nDisableFaults--;
    return b;
};

/**
 * getWord(addr)
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @return {number} word (16-bit) value at that address
 */
BusPDP11.prototype.getWord = function(addr)
{
    var off = addr & this.nBlockLimit;
    var iBlock = (addr & this.nBusMask) >>> this.nBlockShift;
    if (!PDP11.WORDBUS && off == this.nBlockLimit) {
        return this.aMemBlocks[iBlock++].readByte(off, addr) | (this.aMemBlocks[iBlock & this.nBlockMask].readByte(0, addr + 1) << 8);
    }
    return this.aMemBlocks[iBlock].readWord(off, addr);
};

/**
 * getWordDirect(addr)
 *
 * This is useful for the Debugger and other components that want to bypass getWord() breakpoint detection.
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @return {number} word (16-bit) value at that address
 */
BusPDP11.prototype.getWordDirect = function(addr)
{
    var w;
    var off = addr & this.nBlockLimit;
    var iBlock = (addr & this.nBusMask) >>> this.nBlockShift;
    this.nDisableFaults++;
    if (!PDP11.WORDBUS && off == this.nBlockLimit) {
        w = this.aMemBlocks[iBlock++].readByteDirect(off, addr) | (this.aMemBlocks[iBlock & this.nBlockMask].readByteDirect(0, addr + 1) << 8);
    } else {
        w = this.aMemBlocks[iBlock].readWordDirect(off, addr);
    }
    this.nDisableFaults--;
    return w;
};

/**
 * setByte(addr, b)
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @param {number} b is the byte (8-bit) value to write (we truncate it to 8 bits to be safe)
 */
BusPDP11.prototype.setByte = function(addr, b)
{
    this.aMemBlocks[(addr & this.nBusMask) >>> this.nBlockShift].writeByte(addr & this.nBlockLimit, b & 0xff, addr);
};

/**
 * setByteDirect(addr, b)
 *
 * This is useful for the Debugger and other components that want to bypass breakpoint detection AND read-only
 * memory protection (for example, this is an interface the ROM component could use to initialize ROM contents).
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @param {number} b is the byte (8-bit) value to write (we truncate it to 8 bits to be safe)
 */
BusPDP11.prototype.setByteDirect = function(addr, b)
{
    this.nDisableFaults++;
    this.aMemBlocks[(addr & this.nBusMask) >>> this.nBlockShift].writeByteDirect(addr & this.nBlockLimit, b & 0xff, addr);
    this.nDisableFaults--;
};

/**
 * setWord(addr, w)
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @param {number} w is the word (16-bit) value to write (we truncate it to 16 bits to be safe)
 */
BusPDP11.prototype.setWord = function(addr, w)
{
    var off = addr & this.nBlockLimit;
    var iBlock = (addr & this.nBusMask) >>> this.nBlockShift;
    if (!PDP11.WORDBUS && off == this.nBlockLimit) {
        this.aMemBlocks[iBlock++].writeByte(off, w & 0xff, addr);
        this.aMemBlocks[iBlock & this.nBlockMask].writeByte(0, (w >> 8) & 0xff, addr + 1);
        return;
    }
    this.aMemBlocks[iBlock].writeWord(off, w & 0xffff, addr);
};

/**
 * setWordDirect(addr, w)
 *
 * This is useful for the Debugger and other components that want to bypass breakpoint detection AND read-only
 * memory protection (for example, this is an interface the ROM component could use to initialize ROM contents).
 *
 * @this {BusPDP11}
 * @param {number} addr is a physical address
 * @param {number} w is the word (16-bit) value to write (we truncate it to 16 bits to be safe)
 */
BusPDP11.prototype.setWordDirect = function(addr, w)
{
    var off = addr & this.nBlockLimit;
    var iBlock = (addr & this.nBusMask) >>> this.nBlockShift;
    this.nDisableFaults++;
    if (!PDP11.WORDBUS && off == this.nBlockLimit) {
        this.aMemBlocks[iBlock++].writeByteDirect(off, w & 0xff, addr);
        this.aMemBlocks[iBlock & this.nBlockMask].writeByteDirect(0, (w >> 8) & 0xff, addr + 1);
    } else {
        this.aMemBlocks[iBlock].writeWordDirect(off, w & 0xffff, addr);
    }
    this.nDisableFaults--;
};

/**
 * addMemBreak(addr, fWrite)
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @param {boolean} fWrite is true for a memory write breakpoint, false for a memory read breakpoint
 */
BusPDP11.prototype.addMemBreak = function(addr, fWrite)
{
    if (DEBUGGER) {
        var iBlock = addr >>> this.nBlockShift;
        this.aMemBlocks[iBlock].addBreakpoint(addr & this.nBlockLimit, fWrite);
    }
};

/**
 * removeMemBreak(addr, fWrite)
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @param {boolean} fWrite is true for a memory write breakpoint, false for a memory read breakpoint
 */
BusPDP11.prototype.removeMemBreak = function(addr, fWrite)
{
    if (DEBUGGER) {
        var iBlock = addr >>> this.nBlockShift;
        this.aMemBlocks[iBlock].removeBreakpoint(addr & this.nBlockLimit, fWrite);
    }
};

/**
 * saveMemory(fAll)
 *
 * The only memory blocks we save are those marked as dirty, but most likely all of RAM will have been marked dirty,
 * and even if our dirty-memory flags were as smart as our dirty-sector flags (ie, were set only when a write changed
 * what was already there), it's unlikely that would reduce the number of RAM blocks we must save/restore.  At least
 * all the ROM blocks should be clean (except in the unlikely event that the Debugger was used to modify them).
 *
 * All dirty blocks will be stored in a single array, as pairs of block numbers and data arrays, like so:
 *
 *      [iBlock0, [dw0, dw1, ...], iBlock1, [dw0, dw1, ...], ...]
 *
 * In a normal 4Kb block, there will be 1K DWORD values in the data array.  Remember that each DWORD is a signed 32-bit
 * integer (because they are formed using bit-wise operator rather than floating-point math operators), so don't be
 * surprised to see negative numbers in the data.
 *
 * The above example assumes "uncompressed" data arrays.  If we choose to use "compressed" data arrays, the data arrays
 * will look like:
 *
 *      [count0, dw0, count1, dw1, ...]
 *
 * where each count indicates how many times the following DWORD value occurs.  A data array length less than 1K indicates
 * that it's compressed, since we'll only store them in compressed form if they actually shrank, and we'll use State
 * helper methods compress() and decompress() to create and expand the compressed data arrays.
 *
 * @this {BusPDP11}
 * @param {boolean} [fAll] (true to save all non-ROM memory blocks, regardless of their dirty flags)
 * @return {Array} a
 */
BusPDP11.prototype.saveMemory = function(fAll)
{
    var i = 0;
    var a = [];

    for (var iBlock = 0; iBlock < this.nBlockTotal; iBlock++) {
        var block = this.aMemBlocks[iBlock];
        /*
         * We have to check both fDirty and fDirtyEver, because we may have called cleanMemory() on some of
         * the memory blocks (eg, video memory), and while cleanMemory() will clear a dirty block's fDirty flag,
         * it also sets the dirty block's fDirtyEver flag, which is left set for the lifetime of the machine.
         */
        if (fAll && block.type != MemoryPDP11.TYPE.ROM || block.fDirty || block.fDirtyEver) {
            a[i++] = iBlock;
            a[i++] = State.compress(block.save());
        }
    }

    return a;
};

/**
 * restoreMemory(a)
 *
 * This restores the contents of all Memory blocks; called by CPUState.restore().
 *
 * In theory, we ONLY have to save/restore block contents.  Other block attributes,
 * like the type, the memory controller (if any), and the active memory access functions,
 * should already be restored, since every component (re)allocates all the memory blocks
 * it was using when it's restored.  And since the CPU is guaranteed to be the last
 * component to be restored, all those blocks (and their attributes) should be in place now.
 *
 * See saveMemory() for more information on how the memory block contents are saved.
 *
 * @this {BusPDP11}
 * @param {Array} a
 * @return {boolean} true if successful, false if not
 */
BusPDP11.prototype.restoreMemory = function(a)
{
    var i;
    for (i = 0; i < a.length - 1; i += 2) {
        var iBlock = a[i];
        var adw = a[i+1];
        if (adw && adw.length < this.nBlockLen) {
            adw = State.decompress(adw, this.nBlockLen);
        }
        var block = this.aMemBlocks[iBlock];
        if (!block || !block.restore(adw)) {
            /*
             * Either the block to restore hasn't been allocated, indicating a change in the machine
             * configuration since it was last saved (the most likely explanation) or there's some internal
             * inconsistency (eg, the block size is wrong).
             */
            Component.error("Unable to restore memory block " + iBlock);
            return false;
        }
    }
    return true;
};

/**
 * addIOHandlers(start, end, fnReadByte, fnWriteByte, fnReadWord, fnWriteWord, sName)
 *
 * Add I/O notification handlers to the master list (aIOHandlers).  The start and end addresses are typically
 * relative to the starting IOPAGE address, but they can also be absolute; we simply mask all addresses with
 * IOPAGE_MASK.
 *
 * @this {BusPDP11}
 * @param {number} start address
 * @param {number} end address
 * @param {function(number)|null|undefined} fnReadByte
 * @param {function(number,number)|null|undefined} fnWriteByte
 * @param {function(number)|null|undefined} fnReadWord
 * @param {function(number,number)|null|undefined} fnWriteWord
 * @param {string} [sName]
 */
BusPDP11.prototype.addIOHandlers = function(start, end, fnReadByte, fnWriteByte, fnReadWord, fnWriteWord, sName)
{
    for (var addr = start; addr <= end; addr += 2) {
        var off = addr & BusPDP11.IOPAGE_MASK;
        if (this.aIOHandlers[off] !== undefined) {
            Component.warning("I/O address already registered: " + str.toHexLong(addr));
            continue;
        }
        this.aIOHandlers[off] = [fnReadByte, fnWriteByte, fnReadWord, fnWriteWord, sName || "unknown", false];
        if (MAXDEBUG) this.log("addIOHandlers(" + str.toHexLong(addr) + ")");
    }
};

/**
 * addIOTable(component, table)
 *
 * Add I/O notification handlers from the specified table (a batch version of addIOHandlers).
 *
 * @this {BusPDP11}
 * @param {Component} component
 * @param {Object} table
 */
BusPDP11.prototype.addIOTable = function(component, table)
{
    for (var port in table) {
        var addr = +port;
        var afn = table[port];

        /*
         * Don't install (ie, ignore) handlers for I/O addresses that are defined with a model number
         * that is "greater than" than the current model.
         */
        if (afn[5] && afn[5] > this.cpu.model) continue;

        var fnReadByte = afn[0]? afn[0].bind(component) : null;
        var fnWriteByte = afn[1]? afn[1].bind(component) : null;
        var fnReadWord = afn[2]? afn[2].bind(component) : null;
        var fnWriteWord = afn[3]? afn[3].bind(component) : null;

        /*
         * As discussed in the IOController comments above, when handlers are being registered for the following
         * addresses, we must install different fallback handlers for all BYTE accesses.
         */
        if (addr >= PDP11.UNIBUS.R0SET0 && addr <= PDP11.UNIBUS.R6USER) {
            if (!fnReadByte && fnReadWord) {
                fnReadByte = function readByteIORegister(readWord) {
                    return function(addr) {
                        return readWord(addr) & 0xff;
                    }.bind(component);
                }(fnReadWord);
            }
            if (!fnWriteByte && fnWriteWord) {
                fnWriteByte = function writeByteIORegister(writeWord) {
                    return function(data, addr) {
                        return writeWord(data, addr);
                    }.bind(component);
                }(fnWriteWord);
            }
        }
        this.addIOHandlers(addr, addr, fnReadByte, fnWriteByte, fnReadWord, fnWriteWord, afn[4]);
    }
};

/**
 * addResetHandler(fnReset)
 *
 * @this {BusPDP11}
 * @param {function()} fnReset
 */
BusPDP11.prototype.addResetHandler = function(fnReset)
{
    this.afnReset.push(fnReset);
};

/**
 * fault(addr, access)
 *
 * Memory interface for signaling alignment errors, invalid memory
 *
 * @this {BusPDP11}
 * @param {number} addr
 * @param {number} [access] (for diagnostic purposes only)
 */
BusPDP11.prototype.fault = function(addr, access)
{
    if (!this.nDisableFaults) {
        if (DEBUGGER && this.dbg && this.dbg.messageEnabled(MessagesPDP11.BUS)) {
            this.dbg.printMessage("memory fault (" + access + ") on address " + this.dbg.toStrBase(addr), true, true);
            this.dbg.stopInstruction();
        }
        this.cpu.trap(PDP11.TRAP.BUS_ERROR, addr);
    }
};

/**
 * reportError(errNum, addr, size, fQuiet)
 *
 * @this {BusPDP11}
 * @param {number} errNum
 * @param {number} addr
 * @param {number} size
 * @param {boolean} [fQuiet] (true if any error should be quietly logged)
 * @return {boolean} false
 */
BusPDP11.prototype.reportError = function(errNum, addr, size, fQuiet)
{
    var sError = "Memory block error (" + errNum + ": " + str.toHex(addr) + "," + str.toHex(size) + ")";
    if (fQuiet) {
        if (this.dbg) {
            this.dbg.message(sError);
        } else {
            this.log(sError);
        }
    } else {
        Component.error(sError);
    }
    return false;
};

if (NODE) module.exports = BusPDP11;
