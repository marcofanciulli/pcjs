/**
 * @fileoverview Implements the PDP11 Debugger component.
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @version 1.0
 * Created 2016-Sep-03
 *
 * This file is part of PCjs, a computer emulation software project at <http://pcjs.org/>.
 *
 * It has been adapted from the JavaScript PDP 11/70 Emulator v1.3 written by Paul Nankervis
 * (paulnank@hotmail.com) as of August 2016 from http://skn.noip.me/pdp11/pdp11.html.  This code
 * may be used freely provided the original author name is acknowledged in any modified source code.
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
 * You are required to include the above copyright notice in every source code file of every
 * copy or modified version of this work, and to display that copyright notice on every screen
 * that loads or runs any version of this software (see COPYRIGHT in /modules/shared/lib/defines.js).
 *
 * Some PCjs files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of PCjs
 * for purposes of the GNU General Public License, and the author does not claim any copyright
 * as to their contents.
 */

"use strict";

if (DEBUGGER) {
    if (NODE) {
        var str           = require("../../shared/lib/strlib");
        var usr           = require("../../shared/lib/usrlib");
        var web           = require("../../shared/lib/weblib");
        var Component     = require("../../shared/lib/component");
        var Debugger      = require("../../shared/lib/debugger");
        var Keys          = require("../../shared/lib/keys");
        var State         = require("../../shared/lib/state");
        var PDP11         = require("./defines");
        var CPUPDP11      = require("./cpu");
        var MessagesPDP11 = require("./messages");
        var MemoryPDP11   = require("./memory");
    }
}

/**
 * DebuggerPDP11 Address Object
 *
 *      addr            address
 *      fTemporary      true if this is a temporary breakpoint address
 *      sCmd            set for breakpoint addresses if there's an associated command string
 *      aCmds           preprocessed commands (from sCmd)
 *
 * @typedef {{
 *      addr:(number|undefined),
 *      fTemporary:(boolean|undefined),
 *      sCmd:(string|undefined),
 *      aCmds:(Array.<string>|undefined)
 * }} DbgAddrPDP11
 */
var DbgAddrPDP11;

/**
 * DebuggerPDP11(parmsDbg)
 *
 * @constructor
 * @extends Debugger
 * @param {Object} parmsDbg
 *
 * The DebuggerPDP11 component supports the following optional (parmsDbg) properties:
 *
 *      commands: string containing zero or more commands, separated by ';'
 *
 *      messages: string containing zero or more message categories to enable;
 *      multiple categories must be separated by '|' or ';'.  Parsed by messageInit().
 *
 * The DebuggerPDP11 component is an optional component that implements a variety of user
 * commands for controlling the CPU, dumping and editing memory, etc.
 */
function DebuggerPDP11(parmsDbg)
{
    if (DEBUGGER) {

        Debugger.call(this, parmsDbg);

        /*
         * Most commands that require an address call parseAddr(), which defaults to dbgAddrNextCode
         * or dbgAddrNextData when no address has been given.  doDump() and doUnassemble(), in turn,
         * update dbgAddrNextData and dbgAddrNextCode, respectively, when they're done.
         *
         * For TEMPORARY breakpoint addresses, we set fTemporary to true, so that they can be automatically
         * cleared when they're hit.
         */
        this.dbgAddrNextCode = this.newAddr();
        this.dbgAddrNextData = this.newAddr();
        this.dbgAddrAssemble = this.newAddr();

        /*
         * aSymbolTable is an array of SymbolTable objects, one per ROM or other chunk of address space,
         * where each object contains the following properties:
         *
         *      sModule
         *      addr (physical address, if any; eg, symbols for a ROM)
         *      len
         *      aSymbols
         *      aOffsets
         *
         * See addSymbols() for more details, since that's how callers add sets of symbols to the table.
         */
        this.aSymbolTable = [];

        /*
         * clearBreakpoints() initializes the breakpoints lists: aBreakExec is a list of addresses
         * to halt on whenever attempting to execute an instruction at the corresponding address,
         * and aBreakRead and aBreakWrite are lists of addresses to halt on whenever a read or write,
         * respectively, occurs at the corresponding address.
         *
         * NOTE: Curiously, after upgrading the Google Closure Compiler from v20141215 to v20150609,
         * the resulting compiled code would crash in clearBreakpoints(), because the (renamed) aBreakRead
         * property was already defined.  To eliminate whatever was confusing the Closure Compiler, I've
         * explicitly initialized all the properties that clearBreakpoints() (re)initializes.
         */
        this.aBreakExec = this.aBreakRead = this.aBreakWrite = [];
        this.clearBreakpoints();

        /*
         * The new "bn" command allows you to specify a number of instructions to execute and then stop;
         * "bn 0" disables any outstanding count.
         */
        this.nBreakIns = 0;

        /*
         * Execution history is allocated by historyInit() whenever checksEnabled() conditions change.
         * Execution history is updated whenever the CPU calls checkInstruction(), which will happen
         * only when checksEnabled() returns true (eg, whenever one or more breakpoints have been set).
         * This ensures that, by default, the CPU runs as fast as possible.
         */
        this.historyInit();

        /*
         * Initialize DebuggerPDP11 message support
         */
        this.afnDumpers = [];
        this.messageInit(parmsDbg['messages']);

        this.sInitCommands = parmsDbg['commands'];

        /*
         * Make it easier to access DebuggerPDP11 commands from an external REPL (eg, the WebStorm
         * "live" console window); eg:
         *
         *      pdp11('r')
         *      pdp11('dw 0:0')
         *      pdp11('h')
         *      ...
         */
        var dbg = this;
        if (window) {
            if (window[PDP11.APPCLASS] === undefined) {
                window[PDP11.APPCLASS] = function(s) { return dbg.doCommands(s); };
            }
        } else {
            if (global[PDP11.APPCLASS] === undefined) {
                global[PDP11.APPCLASS] = function(s) { return dbg.doCommands(s); };
            }
        }

    }   // endif DEBUGGER
}

if (DEBUGGER) {

    Component.subclass(DebuggerPDP11, Debugger);

    /*
     * NOTE: Every DebuggerPDP11 property from here to the first prototype function definition (initBus()) is
     * considered a "class constant"; most of them use our "all-caps" convention (and all of them SHOULD, but
     * that wouldn't help us catch any bugs).
     *
     * Technically, all of them should ALSO be preceded by a "@const" annotation, but that's a lot of work and it
     * really clutters the code.  I wish the Closure Compiler had a way to annotate every definition with a given
     * section with a single annotation....
     */

    DebuggerPDP11.COMMANDS = {
        '?':        "help/print",
        'a [#]':    "assemble",             // TODO: Implement this command someday
        'b [#]':    "breakpoint",           // multiple variations (use b? to list them)
        'c':        "clear output",
        'd [#]':    "dump memory",          // additional syntax: d [#] [l#], where l# is a number of bytes to dump
        'e [#]':    "edit memory",
        'g [#]':    "go [to #]",
        'h':        "halt",
        'if':       "eval expression",
        'int [#]':  "request interrupt",
        'k':        "stack trace",
        "ln":       "list nearest symbol(s)",
        'm':        "messages",
        'p':        "step over",            // other variations: pr (step and dump registers)
        'print':    "print expression",
        'r':        "dump/set registers",
        'reset':    "reset machine",
        's':        "set options",
        't [#]':    "trace",                // other variations: tr (trace and dump registers)
        'u [#]':    "unassemble",
        'v':        "print version",
        'var':      "assign variable"
    };

    /*
     * CPU opcode ordinals
     */
    DebuggerPDP11.OPS = {
        NONE:   0,      ADC:    1,      ADCB:   2,      ADD:    3,      ASL:    4,      ASLB:   5,      ASR:    6,      ASRB:   7,
        BCC:    8,      BCS:    9,      BEQ:    10,     BGE:    11,     BGT:    12,     BHI:    13,     BIC:    14,     BICB:   15,
        BIS:    16,     BISB:   17,     BIT:    18,     BITB:   19,     BLE:    20,     BLOS:   21,     BLT:    22,     BMI:    23,
        BNE:    24,     BPL:    25,     BPT:    26,     BR:     27,     BVC:    28,     BVS:    29,     CCC:    30,     CLC:    31,
        CLCN:   32,     CLCV:   32,     CLCVN:  33,     CLCVZ:  34,     CLCZ:   35,     CLCZN:  36,     CLN:    37,     CLR:    38,
        CLRB:   40,     CLV:    41,     CLVN:   42,     CLVZ:   43,     CLVZN:  44,     CLZ:    45,     CLZN:   46,     CMP:    47,
        CMPB:   48,     COM:    49,     COMB:   50,     DEC:    51,     DECB:   52,     INC:    53,     INCB:   54,     HALT:   55,
        JMP:    56,     JSR:    57,     MARK:   58,     MFPD:   59,     MFPI:   60,     MFPS:   61,     MOV:    62,     MOVB:   63,
        MTPD:   64,     MTPI:   65,     MTPS:   66,     NEG:    67,     NEGB:   68,     NOP:    69,     RESET:  70,     ROL:    71,
        ROLB:   72,     ROR:    73,     RORB:   74,     RTI:    75,     RTS:    76,     SBC:    77,     SBCB:   78,     SCC:    79,
        SEC:    80,     SECN:   81,     SECV:   82,     SECVN:  83,     SECVZ:  84,     SECZ:   85,     SECZN:  86,     SEN:    87,
        SEV:    88,     SEVN:   89,     SEVZ:   90,     SEVZN:  91,     SEZ:    92,     SEZN:   93,     SUB:    94,     SWAB:   95,
        SXT:    96,     TST:    97,     TSTB:   98,     WAIT:   99
    };

    /*
     * CPU opcode names, indexed by CPU opcode ordinal (above)
     */
    DebuggerPDP11.OPNAMES = [
        "NONE",         "ADC",          "ADCB",         "ADD",          "ASL",          "ASLB",         "ASR",          "ASRB",
        "BCC",          "BCS",          "BEQ",          "BGE",          "BGT",          "BHI",          "BIC",          "BICB",
        "BIS",          "BISB",         "BIT",          "BITB",         "BLE",          "BLOS",         "BLT",          "BMI",
        "BNE",          "BPL",          "BPT",          "BR",           "BVC",          "BVS",          "CCC",          "CLC",
        "CLCN",         "CLCV",         "CLCVN",        "CLCVZ",        "CLCZ",         "CLCZN",        "CLN",          "CLR",
        "CLRB",         "CLV",          "CLVN",         "CLVZ",         "CLVZN",        "CLZ",          "CLZN",         "CMP",
        "CMPB",         "COM",          "COMB",         "DEC",          "DECB",         "INC",          "INCB",         "HALT",
        "JMP",          "JSR",          "MARK",         "MFPD",         "MFPI",         "MFPS",         "MOV",          "MOVB",
        "MTPD",         "MTPI",         "MTPS",         "NEG",          "NEGB",         "NOP",          "RESET",        "ROL",
        "ROLB",         "ROR",          "RORB",         "RTI",          "RTS",          "SBC",          "SBCB",         "SCC",
        "SEC",          "SECN",         "SECV",         "SECVN",        "SECVZ",        "SECZ",         "SECZN",        "SEN",
        "SEV",          "SEVN",         "SEVZ",         "SEVZN",        "SEZ",          "SEZN",         "SUB",          "SWAB",
        "SXT",          "TST",          "TSTB",         "WAIT"
    ];

    DebuggerPDP11.REG_PC     = 0x0C;
    DebuggerPDP11.REG_PSW    = 0x0E;

    DebuggerPDP11.REGS = [
        "PC", "PSW"
    ];

    DebuggerPDP11.MODE_REG      = 0x0;          // REGISTER                 (register is operand)
    DebuggerPDP11.MODE_REGD     = 0x1;          // REGISTER DEFERRED        (register is address of operand)
    DebuggerPDP11.MODE_POSTINC  = 0x2;          // POST-INCREMENT           (register is address of operand, register incremented)
    DebuggerPDP11.MODE_POSTINCD = 0x3;          // POST-INCREMENT DEFERRED  (register is address of address of operand, register incremented)
    DebuggerPDP11.MODE_PREDEC   = 0x4;          // PRE-DECREMENT            (register decremented, register is address of operand)
    DebuggerPDP11.MODE_PREDECD  = 0x5;          // PRE-DECREMENT DEFERRED   (register decremented, register is address of address of operand)
    DebuggerPDP11.MODE_INDEX    = 0x6;          // INDEX                    (register + next word is address of operand)
    DebuggerPDP11.MODE_INDEXD   = 0x7;          // INDEX DEFERRED           (register + next word is address of address of operand)

    /*
     * Operand descriptor masks
     */
    DebuggerPDP11.TYPE_DSTREG   = 0x0007;
    DebuggerPDP11.TYPE_DSTMOD   = 0x0038;
    DebuggerPDP11.TYPE_DST      = (DebuggerPDP11.TYPE_DSTMOD | DebuggerPDP11.TYPE_DSTREG);
    DebuggerPDP11.TYPE_SRCREG   = 0x01C0;
    DebuggerPDP11.TYPE_SRCMOD   = 0x0E00;
    DebuggerPDP11.TYPE_SRC      = (DebuggerPDP11.TYPE_SRCMOD | DebuggerPDP11.TYPE_SRCREG);
    DebuggerPDP11.TYPE_BRANCH   = 0x1000;

    /*
     * The opMasks table contains opcode masks, and each mask refers to table of possible values,
     * and each value refers to an array that contains:
     *
     *      [0]: {number} of the opcode name (see OP.*)
     *      [1]: {number} containing the first operand descriptor bit(s), if any
     *      [2]: {number} containing the second operand descriptor bit(s), if any
     *
     * These sub-elements are all optional. If [0] is not present, the opcode is undefined; if [1] is not
     * present (or contains zero), the opcode has no (or only implied) operands; if [2] is not present, the
     * opcode has only a single operand.  And so on.
     */
    DebuggerPDP11.opMasks = {
        0xF000: {
            0x1000: [DebuggerPDP11.OPS.MOV,     DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0x2000: [DebuggerPDP11.OPS.CMP,     DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0x3000: [DebuggerPDP11.OPS.BIT,     DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0x4000: [DebuggerPDP11.OPS.BIC,     DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0x5000: [DebuggerPDP11.OPS.BIS,     DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0x6000: [DebuggerPDP11.OPS.ADD,     DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0x9000: [DebuggerPDP11.OPS.MOVB,    DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0xA000: [DebuggerPDP11.OPS.CMPB,    DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0xB000: [DebuggerPDP11.OPS.BITB,    DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0xC000: [DebuggerPDP11.OPS.BICB,    DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0xD000: [DebuggerPDP11.OPS.BISB,    DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST],
            0xE000: [DebuggerPDP11.OPS.SUB,     DebuggerPDP11.TYPE_SRC,         DebuggerPDP11.TYPE_DST]
        },
        0xFE00: {
            0x0800: [DebuggerPDP11.OPS.JSR,     DebuggerPDP11.TYPE_SRCREG,      DebuggerPDP11.TYPE_DST]
        },
        0xFF00: {
            0x0100: [DebuggerPDP11.OPS.BR,      DebuggerPDP11.TYPE_BRANCH],
            0x0200: [DebuggerPDP11.OPS.BNE,     DebuggerPDP11.TYPE_BRANCH],
            0x0300: [DebuggerPDP11.OPS.BEQ,     DebuggerPDP11.TYPE_BRANCH],
            0x0400: [DebuggerPDP11.OPS.BGE,     DebuggerPDP11.TYPE_BRANCH],
            0x0500: [DebuggerPDP11.OPS.BLT,     DebuggerPDP11.TYPE_BRANCH],
            0x0600: [DebuggerPDP11.OPS.BGT,     DebuggerPDP11.TYPE_BRANCH],
            0x0700: [DebuggerPDP11.OPS.BLE,     DebuggerPDP11.TYPE_BRANCH],
            0x8000: [DebuggerPDP11.OPS.BPL,     DebuggerPDP11.TYPE_BRANCH],
            0x8100: [DebuggerPDP11.OPS.BMI,     DebuggerPDP11.TYPE_BRANCH],
            0x8200: [DebuggerPDP11.OPS.BHI,     DebuggerPDP11.TYPE_BRANCH],
            0x8300: [DebuggerPDP11.OPS.BLOS,    DebuggerPDP11.TYPE_BRANCH],
            0x8400: [DebuggerPDP11.OPS.BVC,     DebuggerPDP11.TYPE_BRANCH],
            0x8500: [DebuggerPDP11.OPS.BVS,     DebuggerPDP11.TYPE_BRANCH],
            0x8600: [DebuggerPDP11.OPS.BCC,     DebuggerPDP11.TYPE_BRANCH],
            0x8700: [DebuggerPDP11.OPS.BCS,     DebuggerPDP11.TYPE_BRANCH]
        },
        0xFFC0: {
            0x0010: [DebuggerPDP11.OPS.JMP,     DebuggerPDP11.TYPE_DST],
            0x00C0: [DebuggerPDP11.OPS.SWAB,    DebuggerPDP11.TYPE_DST],
            0x0480: [DebuggerPDP11.OPS.INC,     DebuggerPDP11.TYPE_DST],
            0x0A00: [DebuggerPDP11.OPS.CLR,     DebuggerPDP11.TYPE_DST],
            0x0A40: [DebuggerPDP11.OPS.COM,     DebuggerPDP11.TYPE_DST],
            0x0AC0: [DebuggerPDP11.OPS.DEC,     DebuggerPDP11.TYPE_DST],
            0x0B00: [DebuggerPDP11.OPS.NEG,     DebuggerPDP11.TYPE_DST],
            0x0B40: [DebuggerPDP11.OPS.ADC,     DebuggerPDP11.TYPE_DST],
            0x0B80: [DebuggerPDP11.OPS.SBC,     DebuggerPDP11.TYPE_DST],
            0x0BC0: [DebuggerPDP11.OPS.TST,     DebuggerPDP11.TYPE_DST],
            0x0C00: [DebuggerPDP11.OPS.ROR,     DebuggerPDP11.TYPE_DST],
            0x0C40: [DebuggerPDP11.OPS.ROL,     DebuggerPDP11.TYPE_DST],
            0x0C80: [DebuggerPDP11.OPS.ASR,     DebuggerPDP11.TYPE_DST],
            0x0CC0: [DebuggerPDP11.OPS.ASL,     DebuggerPDP11.TYPE_DST],
            0x0D00: [DebuggerPDP11.OPS.MARK,    DebuggerPDP11.TYPE_DST],
            0x0D40: [DebuggerPDP11.OPS.MFPI,    DebuggerPDP11.TYPE_DST],
            0x0D80: [DebuggerPDP11.OPS.MTPI,    DebuggerPDP11.TYPE_DST],
            0x0DC0: [DebuggerPDP11.OPS.SXT,     DebuggerPDP11.TYPE_DST],
            0x8480: [DebuggerPDP11.OPS.INCB,    DebuggerPDP11.TYPE_DST],
            0x8A00: [DebuggerPDP11.OPS.CLRB,    DebuggerPDP11.TYPE_DST],
            0x8A40: [DebuggerPDP11.OPS.COMB,    DebuggerPDP11.TYPE_DST],
            0x8AC0: [DebuggerPDP11.OPS.DECB,    DebuggerPDP11.TYPE_DST],
            0x8B00: [DebuggerPDP11.OPS.NEGB,    DebuggerPDP11.TYPE_DST],
            0x8B40: [DebuggerPDP11.OPS.ADCB,    DebuggerPDP11.TYPE_DST],
            0x8B80: [DebuggerPDP11.OPS.SBCB,    DebuggerPDP11.TYPE_DST],
            0x8BC0: [DebuggerPDP11.OPS.TSTB,    DebuggerPDP11.TYPE_DST],
            0x8C00: [DebuggerPDP11.OPS.RORB,    DebuggerPDP11.TYPE_DST],
            0x8C40: [DebuggerPDP11.OPS.ROLB,    DebuggerPDP11.TYPE_DST],
            0x8C80: [DebuggerPDP11.OPS.ASRB,    DebuggerPDP11.TYPE_DST],
            0x8CC0: [DebuggerPDP11.OPS.ASLB,    DebuggerPDP11.TYPE_DST],
            0x8D00: [DebuggerPDP11.OPS.MTPS,    DebuggerPDP11.TYPE_DST],        // only on LSI-11
            0x8D40: [DebuggerPDP11.OPS.MFPD,    DebuggerPDP11.TYPE_DST],        // same as MFPI if no separate instruction/data spaces
            0x8D80: [DebuggerPDP11.OPS.MTPD,    DebuggerPDP11.TYPE_DST],        // same as MTPI if no separate instruction/data spaces
            0x8DC0: [DebuggerPDP11.OPS.MFPS,    DebuggerPDP11.TYPE_DST]         // only on LSI-11
        },
        0xFFF8: {
            0x0080: [DebuggerPDP11.OPS.RTS,     DebuggerPDP11.TYPE_SRCREG]
        },
        0xFFFF: {
            0x0000: [DebuggerPDP11.OPS.HALT],
            0x0001: [DebuggerPDP11.OPS.WAIT],
            0x0002: [DebuggerPDP11.OPS.RTI],
            0x0004: [DebuggerPDP11.OPS.BPT],
            0x0005: [DebuggerPDP11.OPS.RESET],
            0x00A0: [DebuggerPDP11.OPS.NOP],
            0x00A1: [DebuggerPDP11.OPS.CLC],
            0x00A2: [DebuggerPDP11.OPS.CLV],
            0x00A3: [DebuggerPDP11.OPS.CLCV],
            0x00A4: [DebuggerPDP11.OPS.CLZ],
            0x00A5: [DebuggerPDP11.OPS.CLCZ],
            0x00A6: [DebuggerPDP11.OPS.CLVZ],
            0x00A7: [DebuggerPDP11.OPS.CLCVZ],
            0x00A8: [DebuggerPDP11.OPS.CLN],
            0x00A9: [DebuggerPDP11.OPS.CLCN],
            0x00AA: [DebuggerPDP11.OPS.CLVN],
            0x00AB: [DebuggerPDP11.OPS.CLCVN],
            0x00AC: [DebuggerPDP11.OPS.CLZN],
            0x00AD: [DebuggerPDP11.OPS.CLCZN],
            0x00AE: [DebuggerPDP11.OPS.CLVZN],
            0x00AF: [DebuggerPDP11.OPS.CCC],        // aka CLCVZN
            0x00B0: [DebuggerPDP11.OPS.NOP],
            0x00B1: [DebuggerPDP11.OPS.SEC],
            0x00B2: [DebuggerPDP11.OPS.SEV],
            0x00B3: [DebuggerPDP11.OPS.SECV],
            0x00B4: [DebuggerPDP11.OPS.SEZ],
            0x00B5: [DebuggerPDP11.OPS.SECZ],
            0x00B6: [DebuggerPDP11.OPS.SEVZ],
            0x00B7: [DebuggerPDP11.OPS.SECVZ],
            0x00B8: [DebuggerPDP11.OPS.SEN],
            0x00B9: [DebuggerPDP11.OPS.SECN],
            0x00BA: [DebuggerPDP11.OPS.SEVN],
            0x00BB: [DebuggerPDP11.OPS.SECVN],
            0x00BC: [DebuggerPDP11.OPS.SEZN],
            0x00BD: [DebuggerPDP11.OPS.SECZN],
            0x00BE: [DebuggerPDP11.OPS.SEVZN],
            0x00BF: [DebuggerPDP11.OPS.SCC]         // aka SECVZN
        }
    };

    DebuggerPDP11.HISTORY_LIMIT = DEBUG? 100000 : 1000;

    /**
     * initBus(bus, cpu, dbg)
     *
     * @this {DebuggerPDP11}
     * @param {ComputerPDP11} cmp
     * @param {BusPDP11} bus
     * @param {CPUStatePDP11} cpu
     * @param {DebuggerPDP11} dbg
     */
    DebuggerPDP11.prototype.initBus = function(cmp, bus, cpu, dbg)
    {
        this.bus = bus;
        this.cpu = cpu;
        this.cmp = cmp;

        /*
         * Re-initialize Debugger message support if necessary
         */
        var sMessages = cmp.getMachineParm('messages');
        if (sMessages) this.messageInit(sMessages);

        this.opMasks = DebuggerPDP11.opMasks;

        this.messageDump(MessagesPDP11.BUS,  function onDumpBus(asArgs) { dbg.dumpBus(asArgs); });

        this.setReady();
    };

    /**
     * setBinding(sHTMLType, sBinding, control, sValue)
     *
     * @this {DebuggerPDP11}
     * @param {string|null} sHTMLType is the type of the HTML control (eg, "button", "list", "text", "submit", "textarea", "canvas")
     * @param {string} sBinding is the value of the 'binding' parameter stored in the HTML control's "data-value" attribute (eg, "debugInput")
     * @param {Object} control is the HTML control DOM object (eg, HTMLButtonElement)
     * @param {string} [sValue] optional data value
     * @return {boolean} true if binding was successful, false if unrecognized binding request
     */
    DebuggerPDP11.prototype.setBinding = function(sHTMLType, sBinding, control, sValue)
    {
        var dbg = this;
        switch (sBinding) {

        case "debugInput":
            this.bindings[sBinding] = control;
            this.controlDebug = control;
            /*
             * For halted machines, this is fine, but for auto-start machines, it can be annoying.
             *
             *      control.focus();
             */
            control.onkeydown = function onKeyDownDebugInput(event) {
                var sCmd;
                if (event.keyCode == Keys.KEYCODE.CR) {
                    sCmd = control.value;
                    control.value = "";
                    dbg.doCommands(sCmd, true);
                }
                else if (event.keyCode == Keys.KEYCODE.ESC) {
                    control.value = sCmd = "";
                }
                else {
                    if (event.keyCode == Keys.KEYCODE.UP) {
                        sCmd = dbg.getPrevCommand();
                    }
                    else if (event.keyCode == Keys.KEYCODE.DOWN) {
                        sCmd = dbg.getNextCommand();
                    }
                    if (sCmd != null) {
                        var cch = sCmd.length;
                        control.value = sCmd;
                        control.setSelectionRange(cch, cch);
                    }
                }
                if (sCmd != null && event.preventDefault) event.preventDefault();
            };
            return true;

        case "debugEnter":
            this.bindings[sBinding] = control;
            web.onClickRepeat(
                control,
                500, 100,
                function onClickDebugEnter(fRepeat) {
                    if (dbg.controlDebug) {
                        var sCmd = dbg.controlDebug.value;
                        dbg.controlDebug.value = "";
                        dbg.doCommands(sCmd, true);
                        return true;
                    }
                    if (DEBUG) dbg.log("no debugger input buffer");
                    return false;
                }
            );
            return true;

        case "step":
            this.bindings[sBinding] = control;
            web.onClickRepeat(
                control,
                500, 100,
                function onClickStep(fRepeat) {
                    var fCompleted = false;
                    if (!dbg.isBusy(true)) {
                        dbg.setBusy(true);
                        fCompleted = dbg.stepCPU(fRepeat? 1 : 0);
                        dbg.setBusy(false);
                    }
                    return fCompleted;
                }
            );
            return true;

        default:
            break;
        }
        return false;
    };

    /**
     * updateFocus()
     *
     * @this {DebuggerPDP11}
     */
    DebuggerPDP11.prototype.updateFocus = function()
    {
        if (this.controlDebug) this.controlDebug.focus();
    };

    /**
     * getAddr(dbgAddr, fWrite, nb)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11|null|undefined} dbgAddr
     * @param {boolean} [fWrite]
     * @param {number} [nb] number of bytes to check (1 or 2); default is 1
     * @return {number} is the corresponding linear address, or PDP11.ADDR_INVALID
     */
    DebuggerPDP11.prototype.getAddr = function(dbgAddr, fWrite, nb)
    {
        var addr = dbgAddr && dbgAddr.addr;
        if (addr == null) {
            addr = PDP11.ADDR_INVALID;
        }
        return addr;
    };

    /**
     * getByte(dbgAddr, inc)
     *
     * We must route all our memory requests through the CPU now, in case paging is enabled.
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {number} [inc]
     * @return {number}
     */
    DebuggerPDP11.prototype.getByte = function(dbgAddr, inc)
    {
        var b = 0xff;
        var addr = this.getAddr(dbgAddr, false, 1);
        if (addr !== PDP11.ADDR_INVALID) {
            b = this.bus.getByteDirect(addr);
            if (inc) this.incAddr(dbgAddr, inc);
        }
        return b;
    };

    /**
     * getWord(dbgAddr, fAdvance)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {boolean} [fAdvance]
     * @return {number}
     */
    DebuggerPDP11.prototype.getWord = function(dbgAddr, fAdvance)
    {
        return this.getShort(dbgAddr, fAdvance? 2 : 0);
    };

    /**
     * getShort(dbgAddr, inc)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {number} [inc]
     * @return {number}
     */
    DebuggerPDP11.prototype.getShort = function(dbgAddr, inc)
    {
        var w = 0xffff;
        var addr = this.getAddr(dbgAddr, false, 2);
        if (addr !== PDP11.ADDR_INVALID) {
            w = this.bus.getShortDirect(addr);
            if (inc) this.incAddr(dbgAddr, inc);
        }
        return w;
    };

    /**
     * setByte(dbgAddr, b, inc)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {number} b
     * @param {number} [inc]
     */
    DebuggerPDP11.prototype.setByte = function(dbgAddr, b, inc)
    {
        var addr = this.getAddr(dbgAddr, true, 1);
        if (addr !== PDP11.ADDR_INVALID) {
            this.bus.setByteDirect(addr, b);
            if (inc) this.incAddr(dbgAddr, inc);
            this.cpu.updateCPU(true);           // we set fForce to true in case video memory was the target
        }
    };

    /**
     * setShort(dbgAddr, w, inc)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {number} w
     * @param {number} [inc]
     */
    DebuggerPDP11.prototype.setShort = function(dbgAddr, w, inc)
    {
        var addr = this.getAddr(dbgAddr, true, 2);
        if (addr !== PDP11.ADDR_INVALID) {
            this.bus.setShortDirect(addr, w);
            if (inc) this.incAddr(dbgAddr, inc);
            this.cpu.updateCPU(true);           // we set fForce to true in case video memory was the target
        }
    };

    /**
     * newAddr(addr)
     *
     * Returns a NEW DbgAddrPDP11 object, initialized with specified values and/or defaults.
     *
     * @this {DebuggerPDP11}
     * @param {number} [addr]
     * @return {DbgAddrPDP11}
     */
    DebuggerPDP11.prototype.newAddr = function(addr)
    {
        return {addr: addr, fTemporary: false};
    };

    /**
     * setAddr(dbgAddr, addr)
     *
     * Updates an EXISTING DbgAddrPDP11 object, initialized with specified values and/or defaults.
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {number} addr
     * @return {DbgAddrPDP11}
     */
    DebuggerPDP11.prototype.setAddr = function(dbgAddr, addr)
    {
        dbgAddr.addr = addr;
        dbgAddr.fTemporary = false;
        return dbgAddr;
    };

    /**
     * packAddr(dbgAddr)
     *
     * Packs a DbgAddrPDP11 object into an Array suitable for saving in a machine state object.
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @return {Array}
     */
    DebuggerPDP11.prototype.packAddr = function(dbgAddr)
    {
        return [dbgAddr.addr, dbgAddr.fTemporary];
    };

    /**
     * unpackAddr(aAddr)
     *
     * Unpacks a DbgAddrPDP11 object from an Array created by packAddr() and restored from a saved machine state.
     *
     * @this {DebuggerPDP11}
     * @param {Array} aAddr
     * @return {DbgAddrPDP11}
     */
    DebuggerPDP11.prototype.unpackAddr = function(aAddr)
    {
        return {addr: aAddr[0], fTemporary: aAddr[1]};
    };

    /**
     * parseAddr(sAddr, fCode, fNoChecks, fPrint)
     *
     * Address evaluation and validation (eg, range checks) are no longer performed at this stage.  That's
     * done later, by getAddr(), which returns PDP11.ADDR_INVALID for invalid segments, out-of-range offsets,
     * etc.  The Debugger's low-level get/set memory functions verify all getAddr() results, but even if an
     * invalid address is passed through to the Bus memory interfaces, the address will simply be masked with
     * BusPDP11.nBusLimit; in the case of PDP11.ADDR_INVALID, that will generally refer to the top of the physical
     * address space.
     *
     * @this {DebuggerPDP11}
     * @param {string|undefined} sAddr
     * @param {boolean} [fCode] (true if target is code, false if target is data)
     * @param {boolean} [fNoChecks] (true when setting breakpoints that may not be valid now, but will be later)
     * @param {boolean} [fPrint]
     * @return {DbgAddrPDP11|null|undefined}
     */
    DebuggerPDP11.prototype.parseAddr = function(sAddr, fCode, fNoChecks, fPrint)
    {
        var dbgAddr;
        var dbgAddrNext = (fCode? this.dbgAddrNextCode : this.dbgAddrNextData);
        var addr = dbgAddrNext.addr;
        if (sAddr !== undefined) {
            sAddr = this.parseReference(sAddr);
            dbgAddr = this.findSymbolAddr(sAddr);
            if (dbgAddr) return dbgAddr;
            addr = this.parseExpression(sAddr, fPrint);
        }
        if (addr != null) {
            dbgAddr = this.newAddr(addr);
        }
        return dbgAddr;
    };

    /**
     * parseAddrOptions(dbdAddr, sOptions)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {string} [sOptions]
     */
    DebuggerPDP11.prototype.parseAddrOptions = function(dbgAddr, sOptions)
    {
        if (sOptions) {
            var a = sOptions.match(/(['"])(.*?)\1/);
            if (a) {
                dbgAddr.aCmds = this.parseCommand(dbgAddr.sCmd = a[2]);
            }
        }
    };

    /**
     * incAddr(dbgAddr, inc)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {number} [inc] contains value to increment dbgAddr by (default is 1)
     */
    DebuggerPDP11.prototype.incAddr = function(dbgAddr, inc)
    {
        if (dbgAddr.addr != null) {
            dbgAddr.addr += (inc || 1);
        }
    };

    /**
     * toHexOffset(off)
     *
     * @this {DebuggerPDP11}
     * @param {number|null|undefined} [off]
     * @return {string} the hex representation of off
     */
    DebuggerPDP11.prototype.toHexOffset = function(off)
    {
        return str.toHex(off, 4);
    };

    /**
     * toHexAddr(dbgAddr)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @return {string} the hex representation of the address
     */
    DebuggerPDP11.prototype.toHexAddr = function(dbgAddr)
    {
        return this.toHexOffset(dbgAddr.addr);
    };

    /**
     * getSZ(dbgAddr, cchMax)
     *
     * Gets zero-terminated (aka "ASCIIZ") string from dbgAddr.  It also stops at the first '$', in case this is
     * a '$'-terminated string -- mainly because I'm lazy and didn't feel like writing a separate get() function.
     * Yes, a zero-terminated string containing a '$' will be prematurely terminated, and no, I don't care.
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {number} [cchMax] (default is 256)
     * @return {string} (and dbgAddr advanced past the terminating zero)
     */
    DebuggerPDP11.prototype.getSZ = function(dbgAddr, cchMax)
    {
        var s = "";
        cchMax = cchMax || 256;
        while (s.length < cchMax) {
            var b = this.getByte(dbgAddr, 1);
            if (!b || b == 0x24 || b >= 127) break;
            s += (b >= 32? String.fromCharCode(b) : '.');
        }
        return s;
    };

    /**
     * dumpBlocks(aBlocks, sAddr)
     *
     * @this {DebuggerPDP11}
     * @param {Array} aBlocks
     * @param {string} [sAddr] (optional block address)
     */
    DebuggerPDP11.prototype.dumpBlocks = function(aBlocks, sAddr)
    {
        var addr = 0, i = 0, n = aBlocks.length;

        if (sAddr) {
            addr = this.getAddr(this.parseAddr(sAddr));
            if (addr === PDP11.ADDR_INVALID) {
                this.println("invalid address: " + sAddr);
                return;
            }
            i = addr >>> this.bus.nBlockShift;
            n = 1;
        }

        this.println("blockid   physical   blockaddr   used    size    type");
        this.println("--------  ---------  ----------  ------  ------  ----");

        var typePrev = -1, cPrev = 0;
        while (n--) {
            var block = aBlocks[i];
            if (block.type == typePrev) {
                if (!cPrev++) this.println("...");
            } else {
                typePrev = block.type;
                var sType = MemoryPDP11.TYPE.NAMES[typePrev];
                if (block) {
                    this.println(str.toHex(block.id) + "  %" + str.toHex(i << this.bus.nBlockShift) + "  %%" + str.toHex(block.addr) + "  " + str.toHexWord(block.used) + "  " + str.toHexWord(block.size) + "  " + sType);
                }
                if (typePrev != MemoryPDP11.TYPE.NONE) typePrev = -1;
                cPrev = 0;
            }
            addr += this.bus.nBlockSize;
            i++;
        }
    };

    /**
     * dumpBus(asArgs)
     *
     * Dumps Bus allocations.
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs (asArgs[0] is an optional block address)
     */
    DebuggerPDP11.prototype.dumpBus = function(asArgs)
    {
        this.dumpBlocks(this.bus.aMemBlocks, asArgs[0]);
    };

    /**
     * dumpHistory(sPrev, sLines)
     *
     * If sLines is not a number, it can be a instruction filter.  However, for the moment, the only
     * supported filter is "call", which filters the history buffer for all CALL and RET instructions
     * from the specified previous point forward.
     *
     * @this {DebuggerPDP11}
     * @param {string} [sPrev] is a (decimal) number of instructions to rewind to (default is 10)
     * @param {string} [sLines] is a (decimal) number of instructions to print (default is, again, 10)
     */
    DebuggerPDP11.prototype.dumpHistory = function(sPrev, sLines)
    {
        var sMore = "";
        var cHistory = 0;
        var iHistory = this.iOpcodeHistory;
        var aHistory = this.aOpcodeHistory;

        if (aHistory.length) {
            var nPrev = +sPrev || this.nextHistory;
            var nLines = +sLines || 10;

            if (isNaN(nPrev)) {
                nPrev = nLines;
            } else {
                sMore = "more ";
            }

            if (nPrev > aHistory.length) {
                this.println("note: only " + aHistory.length + " available");
                nPrev = aHistory.length;
            }

            iHistory -= nPrev;
            if (iHistory < 0) {
                /*
                 * If the dbgAddr of the last aHistory element contains a valid selector, wrap around.
                 */
                if (aHistory[aHistory.length - 1].addr == null) {
                    nPrev = iHistory + nPrev;
                    iHistory = 0;
                } else {
                    iHistory += aHistory.length;
                }
            }

            var aFilters = [];
            if (sLines == "call") {
                nLines = 100000;
                aFilters = ["CALL"];
            }

            if (sPrev !== undefined) {
                this.println(nPrev + " instructions earlier:");
            }

            /*
             * TODO: The following is necessary to prevent dumpHistory() from causing additional (or worse, recursive)
             * faults due to segmented addresses that are no longer valid, but the only alternative is to dramatically
             * increase the amount of memory used to store instruction history (eg, storing copies of all the instruction
             * bytes alongside the execution addresses).
             *
             * For now, we're living dangerously, so that our history dumps actually work.
             *
             *      this.nSuppressBreaks++;
             *
             * If you re-enable this protection, be sure to re-enable the decrement below, too.
             */
            while (nLines > 0 && iHistory != this.iOpcodeHistory) {

                var dbgAddr = aHistory[iHistory++];
                if (dbgAddr.addr == null) break;

                /*
                 * We must create a new dbgAddr from the address in aHistory, because dbgAddr was
                 * a reference, not a copy, and we don't want getInstruction() modifying the original.
                 */
                var dbgAddrNew = this.newAddr(dbgAddr.addr);

                var sComment = "history";
                var nSequence = nPrev--;
                if (DEBUG && dbgAddr.cycleCount != null) {
                    sComment = "cycles";
                    nSequence = dbgAddr.cycleCount;
                }

                var sInstruction = this.getInstruction(dbgAddrNew, sComment, nSequence);

                if (!aFilters.length || sInstruction.indexOf(aFilters[0]) >= 0) {
                    this.println(sInstruction);
                }

                /*
                 * If there were OPERAND or ADDRESS overrides on the previous instruction, getInstruction()
                 * will have automatically disassembled additional bytes, so skip additional history entries.
                 */
                if (dbgAddrNew.cOverrides) {
                    iHistory += dbgAddrNew.cOverrides; nLines -= dbgAddrNew.cOverrides; nPrev -= dbgAddrNew.cOverrides;
                }

                if (iHistory >= aHistory.length) iHistory = 0;
                this.nextHistory = nPrev;
                cHistory++;
                nLines--;
            }
            /*
             * See comments above.
             *
             *      this.nSuppressBreaks--;
             */
        }

        if (!cHistory) {
            this.println("no " + sMore + "history available");
            this.nextHistory = undefined;
        }
    };

    /**
     * messageInit(sEnable)
     *
     * @this {DebuggerPDP11}
     * @param {string|undefined} sEnable contains zero or more message categories to enable, separated by '|'
     */
    DebuggerPDP11.prototype.messageInit = function(sEnable)
    {
        this.dbg = this;
        this.bitsMessage = this.bitsWarning = MessagesPDP11.WARN;
        this.sMessagePrev = null;
        this.aMessageBuffer = [];
        /*
         * Internally, we use "key" instead of "keys", since the latter is a method on JavasScript objects,
         * but externally, we allow the user to specify "keys"; "kbd" is also allowed as shorthand for "keyboard".
         */
        var aEnable = this.parseCommand(sEnable.replace("keys","key").replace("kbd","keyboard"), false, '|');
        if (aEnable.length) {
            for (var m in MessagesPDP11.CATEGORIES) {
                if (usr.indexOf(aEnable, m) >= 0) {
                    this.bitsMessage |= MessagesPDP11.CATEGORIES[m];
                    this.println(m + " messages enabled");
                }
            }
        }
    };

    /**
     * messageDump(bitMessage, fnDumper)
     *
     * @this {DebuggerPDP11}
     * @param {number} bitMessage is one Messages category flag
     * @param {function(Array.<string>)} fnDumper is a function the Debugger can use to dump data for that category
     * @return {boolean} true if successfully registered, false if not
     */
    DebuggerPDP11.prototype.messageDump = function(bitMessage, fnDumper)
    {
        for (var m in MessagesPDP11.CATEGORIES) {
            if (bitMessage == MessagesPDP11.CATEGORIES[m]) {
                this.afnDumpers[m] = fnDumper;
                return true;
            }
        }
        return false;
    };

    /**
     * getRegIndex(sReg, off)
     *
     * @this {DebuggerPDP11}
     * @param {string} sReg
     * @param {number} [off] optional offset into sReg
     * @return {number} register index, or -1 if not found
     */
    DebuggerPDP11.prototype.getRegIndex = function(sReg, off)
    {
        var i;
        sReg = sReg.toUpperCase();
        if (off == null) {
            i = usr.indexOf(DebuggerPDP11.REGS, sReg);
        } else {
            i = usr.indexOf(DebuggerPDP11.REGS, sReg.substr(off, 2));
            if (i < 0) i = usr.indexOf(DebuggerPDP11.REGS, sReg.substr(off, 1));
        }
        return i;
    };

    /**
     * getRegString(iReg)
     *
     * @this {DebuggerPDP11}
     * @param {number} iReg
     * @return {string}
     */
    DebuggerPDP11.prototype.getRegString = function(iReg)
    {
        var cch = 0;
        var n = this.getRegValue(iReg);
        if (n !== undefined) {
            switch(iReg) {
            case DebuggerPDP11.REG_PC:
            case DebuggerPDP11.REG_PSW:
                cch = 4;
                break;
            }
        }
        return cch? str.toHex(n, cch) : "??";
    };

    /**
     * getRegValue(iReg)
     *
     * @this {DebuggerPDP11}
     * @param {number} iReg
     * @return {number|undefined}
     */
    DebuggerPDP11.prototype.getRegValue = function(iReg)
    {
        var n;
        if (iReg >= 0) {
            var cpu = this.cpu;
            switch(iReg) {
            case DebuggerPDP11.REG_PC:
                n = cpu.getPC();
                break;
            case DebuggerPDP11.REG_PSW:
                n = cpu.getPSW();
                break;
            default:
                break;
            }
        }
        return n;
    };

    /**
     * replaceRegs(s)
     *
     * @this {DebuggerPDP11}
     * @param {string} s
     * @return {string}
     */
    DebuggerPDP11.prototype.replaceRegs = function(s)
    {
        /*
         * Replace any references first; this means that register references inside the reference
         * do NOT need to be prefixed with '@'.
         */
        s = this.parseReference(s);

        /*
         * Replace every @XX (or @XXX), where XX (or XXX) is a register, with the register's value.
         */
        var i = 0;
        var b, sChar, sAddr, dbgAddr, sReplace;
        while ((i = s.indexOf('@', i)) >= 0) {
            var iReg = this.getRegIndex(s, i + 1);
            if (iReg >= 0) {
                s = s.substr(0, i) + this.getRegString(iReg) + s.substr(i + 1 + DebuggerPDP11.REGS[iReg].length);
            }
            i++;
        }
        /*
         * Replace every #XX, where XX is a hex byte value, with the corresponding ASCII character (if printable).
         */
        i = 0;
        while ((i = s.indexOf('#', i)) >= 0) {
            sChar = s.substr(i+1, 2);
            b = str.parseInt(sChar, 16);
            if (b != null && b >= 32 && b < 128) {
                sReplace = sChar + " '" + String.fromCharCode(b) + "'";
                s = s.replace('#' + sChar, sReplace);
                i += sReplace.length;
                continue;
            }
            i++;
        }
        /*
         * Replace every $XXXX:XXXX, where XXXX:XXXX is a segmented address, with the zero-terminated string at that address.
         */
        i = 0;
        while ((i = s.indexOf('$', i)) >= 0) {
            sAddr = s.substr(i+1, 9);
            dbgAddr = this.parseAddr(sAddr);
            if (dbgAddr) {
                sReplace = sAddr + ' "' + this.getSZ(dbgAddr) + '"';
                s = s.replace('$' + sAddr, sReplace);
                i += sReplace.length;
                continue;
            }
            i++;
        }
        /*
         * Replace every ^XXXX:XXXX, where XXXX:XXXX is a segmented address, with the FCB filename stored at that address.
         */
        i = 0;
        while ((i = s.indexOf('^', i)) >= 0) {
            sAddr = s.substr(i+1, 9);
            dbgAddr = this.parseAddr(sAddr);
            if (dbgAddr) {
                this.incAddr(dbgAddr);
                sReplace = sAddr + ' "' + this.getSZ(dbgAddr, 11) + '"';
                s = s.replace('^' + sAddr, sReplace);
                i += sReplace.length;
                continue;
            }
            i++;
        }
        return s;
    };

    /**
     * message(sMessage, fAddress)
     *
     * @this {DebuggerPDP11}
     * @param {string} sMessage is any caller-defined message string
     * @param {boolean} [fAddress] is true to display the current CS:IP
     */
    DebuggerPDP11.prototype.message = function(sMessage, fAddress)
    {
        if (fAddress) {
            sMessage += " at " + this.toHexAddr(this.newAddr(this.cpu.getPC()));
        }

        if (this.bitsMessage & MessagesPDP11.BUFFER) {
            this.aMessageBuffer.push(sMessage);
            return;
        }

        if (this.sMessagePrev && sMessage == this.sMessagePrev) return;
        this.sMessagePrev = sMessage;

        if (this.bitsMessage & MessagesPDP11.HALT) {
            this.stopCPU();
            sMessage += " (cpu halted)";
        }

        this.println(sMessage); // + " (" + this.cpu.getCycles() + " cycles)"

        /*
         * We have no idea what the frequency of println() calls might be; all we know is that they easily
         * screw up the CPU's careful assumptions about cycles per burst.  So we call yieldCPU() after every
         * message, to effectively end the current burst and start fresh.
         *
         * TODO: See CPUPDP11.calcStartTime() for a discussion of why we might want to call yieldCPU() *before*
         * we display the message.
         */
        if (this.cpu) this.cpu.yieldCPU();
    };

    /**
     * init()
     *
     * @this {DebuggerPDP11}
     */
    DebuggerPDP11.prototype.init = function()
    {
        this.println("Type ? for help with PDP11 Debugger commands");
        this.updateStatus();
        if (this.sInitCommands) {
            var sCmds = this.sInitCommands;
            this.sInitCommands = null;
            this.doCommands(sCmds);
        }
    };

    /**
     * historyInit(fQuiet)
     *
     * This function is intended to be called by the constructor, reset(), addBreakpoint(), findBreakpoint()
     * and any other function that changes the checksEnabled() criteria used to decide whether checkInstruction()
     * should be called.
     *
     * That is, if the history arrays need to be allocated and haven't already been allocated, then allocate them,
     * and if the arrays are no longer needed, then deallocate them.
     *
     * @this {DebuggerPDP11}
     * @param {boolean} [fQuiet]
     */
    DebuggerPDP11.prototype.historyInit = function(fQuiet)
    {
        var i;
        if (!this.checksEnabled()) {
            if (this.aOpcodeHistory && this.aOpcodeHistory.length && !fQuiet) {
                this.println("instruction history buffer freed");
            }
            this.iOpcodeHistory = 0;
            this.aOpcodeHistory = [];
            this.aaOpcodeCounts = [];
            return;
        }
        if (!this.aOpcodeHistory || !this.aOpcodeHistory.length) {
            this.aOpcodeHistory = new Array(DebuggerPDP11.HISTORY_LIMIT);
            for (i = 0; i < this.aOpcodeHistory.length; i++) {
                /*
                 * Preallocate dummy Addr (Array) objects in every history slot, so that
                 * checkInstruction() doesn't need to call newAddr() on every slot update.
                 */
                this.aOpcodeHistory[i] = this.newAddr();
            }
            this.iOpcodeHistory = 0;
            if (!fQuiet) {
                this.println("instruction history buffer allocated");
            }
        }
        if (!this.aaOpcodeCounts || !this.aaOpcodeCounts.length) {
            this.aaOpcodeCounts = new Array(256);
            for (i = 0; i < this.aaOpcodeCounts.length; i++) {
                this.aaOpcodeCounts[i] = [i, 0];
            }
        }
    };

    /**
     * runCPU(fUpdateFocus)
     *
     * @this {DebuggerPDP11}
     * @param {boolean} [fUpdateFocus] is true to update focus
     * @return {boolean} true if run request successful, false if not
     */
    DebuggerPDP11.prototype.runCPU = function(fUpdateFocus)
    {
        if (!this.isCPUAvail()) return false;
        this.cpu.runCPU(fUpdateFocus);
        return true;
    };

    /**
     * stepCPU(nCycles, fRegs, fUpdateCPU)
     *
     * @this {DebuggerPDP11}
     * @param {number} nCycles (0 for one instruction without checking breakpoints)
     * @param {boolean} [fRegs] is true to display registers after step (default is false)
     * @param {boolean} [fUpdateCPU] is false to disable calls to updateCPU() (default is true)
     * @return {boolean}
     */
    DebuggerPDP11.prototype.stepCPU = function(nCycles, fRegs, fUpdateCPU)
    {
        if (!this.isCPUAvail()) return false;

        this.nCycles = 0;

        if (!nCycles) {
            /*
             * When single-stepping, the CPU won't call checkInstruction(), which is good for
             * avoiding breakpoints, but bad for instruction data collection if checks are enabled.
             * So we call checkInstruction() ourselves.
             */
            if (this.checksEnabled()) this.checkInstruction(this.cpu.getPC(), 0);
        }
        try {
            var nCyclesStep = this.cpu.stepCPU(nCycles);
            if (nCyclesStep > 0) {
                this.nCycles += nCyclesStep;
                this.cpu.addCycles(nCyclesStep, true);
                this.cpu.updateChecksum(nCyclesStep);
                this.cOpcodes++;
            }
        }
        catch(exception) {
            if (typeof exception != "number") {
                var e = exception;
                this.nCycles = 0;
                this.cpu.setError(e.stack || e.message);
            }
        }

        /*
         * Because we called cpu.stepCPU() and not cpu.runCPU(), we must nudge the cpu's update code,
         * and then update our own state.  Normally, the only time fUpdateCPU will be false is when doTrace()
         * is calling us in a loop, in which case it will perform its own updateCPU() when it's done.
         */
        if (fUpdateCPU !== false) this.cpu.updateCPU();

        this.updateStatus(fRegs || false);
        return (this.nCycles > 0);
    };

    /**
     * stopCPU()
     *
     * @this {DebuggerPDP11}
     * @param {boolean} [fComplete]
     */
    DebuggerPDP11.prototype.stopCPU = function(fComplete)
    {
        if (this.cpu) this.cpu.stopCPU(fComplete);
    };

    /**
     * updateStatus(fRegs)
     *
     * @this {DebuggerPDP11}
     * @param {boolean} [fRegs] (default is true)
     */
    DebuggerPDP11.prototype.updateStatus = function(fRegs)
    {
        if (fRegs === undefined) fRegs = true;

        this.dbgAddrNextCode = this.newAddr(this.cpu.getPC());
        /*
         * this.nStep used to be a simple boolean, but now it's 0 (or undefined)
         * if inactive, 1 if stepping over an instruction without a register dump, or 2
         * if stepping over an instruction with a register dump.
         */
        if (!fRegs || this.nStep == 1)
            this.doUnassemble();
        else {
            this.doRegisters();
        }
    };

    /**
     * isCPUAvail()
     *
     * Make sure the CPU is ready (finished initializing), not busy (already running), and not in an error state.
     *
     * @this {DebuggerPDP11}
     * @return {boolean}
     */
    DebuggerPDP11.prototype.isCPUAvail = function()
    {
        if (!this.cpu)
            return false;
        if (!this.cpu.isReady())
            return false;
        if (!this.cpu.isPowered())
            return false;
        if (this.cpu.isBusy())
            return false;
        return !this.cpu.isError();
    };

    /**
     * powerUp(data, fRepower)
     *
     * @this {DebuggerPDP11}
     * @param {Object|null} data
     * @param {boolean} [fRepower]
     * @return {boolean} true if successful, false if failure
     */
    DebuggerPDP11.prototype.powerUp = function(data, fRepower)
    {
        if (!fRepower) {
            /*
             * Because Debugger save/restore support is somewhat limited (and didn't always exist),
             * we deviate from the typical save/restore design pattern: instead of reset OR restore,
             * we always reset and then perform a (potentially limited) restore.
             */
            this.reset(true);

            // this.println(data? "resuming" : "powering up");

            if (data && this.restore) {
                if (!this.restore(data)) return false;
            }
        }
        return true;
    };

    /**
     * powerDown(fSave, fShutdown)
     *
     * @this {DebuggerPDP11}
     * @param {boolean} [fSave]
     * @param {boolean} [fShutdown]
     * @return {Object|boolean}
     */
    DebuggerPDP11.prototype.powerDown = function(fSave, fShutdown)
    {
        if (fShutdown) this.println(fSave? "suspending" : "shutting down");
        return fSave? this.save() : true;
    };

    /**
     * reset(fQuiet)
     *
     * This is a notification handler, called by the Computer, to inform us of a reset.
     *
     * @this {DebuggerPDP11}
     * @param {boolean} fQuiet (true only when called from our own powerUp handler)
     */
    DebuggerPDP11.prototype.reset = function(fQuiet)
    {
        this.historyInit();
        this.cOpcodes = this.cOpcodesStart = 0;
        this.sMessagePrev = null;
        this.nCycles = 0;
        this.dbgAddrNextCode = this.newAddr(this.cpu.getPC());
        /*
         * fRunning is set by start() and cleared by stop().  In addition, we clear
         * it here, so that if the CPU is reset while running, we can prevent stop()
         * from unnecessarily dumping the CPU state.
         */
        this.flags.running = false;
        this.clearTempBreakpoint();
        if (!fQuiet) this.updateStatus();
    };

    /**
     * save()
     *
     * This implements (very rudimentary) save support for the Debugger component.
     *
     * @this {DebuggerPDP11}
     * @return {Object}
     */
    DebuggerPDP11.prototype.save = function()
    {
        var state = new State(this);
        state.set(0, this.packAddr(this.dbgAddrNextCode));
        state.set(1, this.packAddr(this.dbgAddrAssemble));
        state.set(2, [this.aPrevCmds, this.fAssemble, this.bitsMessage]);
        state.set(3, this.aSymbolTable);
        return state.data();
    };

    /**
     * restore(data)
     *
     * This implements (very rudimentary) restore support for the Debugger component.
     *
     * @this {DebuggerPDP11}
     * @param {Object} data
     * @return {boolean} true if successful, false if failure
     */
    DebuggerPDP11.prototype.restore = function(data)
    {
        var i = 0;
        if (data[2] !== undefined) {
            this.dbgAddrNextCode = this.unpackAddr(data[i++]);
            this.dbgAddrAssemble = this.unpackAddr(data[i++]);
            this.aPrevCmds = data[i][0];
            if (typeof this.aPrevCmds == "string") this.aPrevCmds = [this.aPrevCmds];
            this.fAssemble = data[i][1];
            this.bitsMessage |= data[i][2];     // keep our current message bits set, and simply "add" any extra bits defined by the saved state
        }
        if (data[3]) this.aSymbolTable = data[3];
        return true;
    };

    /**
     * start(ms, nCycles)
     *
     * This is a notification handler, called by the Computer, to inform us the CPU has started.
     *
     * @this {DebuggerPDP11}
     * @param {number} ms
     * @param {number} nCycles
     */
    DebuggerPDP11.prototype.start = function(ms, nCycles)
    {
        if (!this.nStep) this.println("running");
        this.flags.running = true;
        this.msStart = ms;
        this.nCyclesStart = nCycles;
    };

    /**
     * stop(ms, nCycles)
     *
     * This is a notification handler, called by the Computer, to inform us the CPU has now stopped.
     *
     * @this {DebuggerPDP11}
     * @param {number} ms
     * @param {number} nCycles
     */
    DebuggerPDP11.prototype.stop = function(ms, nCycles)
    {
        if (this.flags.running) {
            this.flags.running = false;
            this.nCycles = nCycles - this.nCyclesStart;
            if (!this.nStep) {
                var sStopped = "stopped";
                if (this.nCycles) {
                    var msTotal = ms - this.msStart;
                    var nCyclesPerSecond = (msTotal > 0? Math.round(this.nCycles * 1000 / msTotal) : 0);
                    sStopped += " (";
                    if (this.checksEnabled()) {
                        sStopped += this.cOpcodes + " opcodes, ";
                        /*
                         * $ops displays progress by calculating cOpcodes - cOpcodesStart, so before
                         * zeroing cOpcodes, we should subtract cOpcodes from cOpcodesStart (since we're
                         * effectively subtracting cOpcodes from cOpcodes as well).
                         */
                        this.cOpcodesStart -= this.cOpcodes;
                        this.cOpcodes = 0;
                    }
                    sStopped += this.nCycles + " cycles, " + msTotal + " ms, " + nCyclesPerSecond + " hz)";
                } else {
                    if (this.messageEnabled(MessagesPDP11.HALT)) {
                        /*
                         * It's possible the user is trying to 'g' past a fault that was blocked by helpCheckFault()
                         * for the Debugger's benefit; if so, it will continue to be blocked, so try displaying a helpful
                         * message (another helpful tip would be to simply turn off the "halt" message category).
                         */
                        sStopped += " (use the 't' command to execute blocked faults)";
                    }
                }
                this.println(sStopped);
            }
            this.updateStatus(true);
            this.updateFocus();
            this.clearTempBreakpoint(this.cpu.getPC());
        }
    };

    /**
     * checksEnabled(fRelease)
     *
     * This "check" function is called by the CPU; we indicate whether or not every instruction needs to be checked.
     *
     * Originally, this returned true even when there were only read and/or write breakpoints, but those breakpoints
     * no longer require the intervention of checkInstruction(); the Bus component automatically swaps in/out appropriate
     * "checked" Memory access functions to deal with those breakpoints in the corresponding Memory blocks.  So I've
     * simplified the test below.
     *
     * @this {DebuggerPDP11}
     * @param {boolean} [fRelease] is true for release criteria only; default is false (any criteria)
     * @return {boolean} true if every instruction needs to pass through checkInstruction(), false if not
     */
    DebuggerPDP11.prototype.checksEnabled = function(fRelease)
    {
        return ((DEBUG && !fRelease)? true : (this.aBreakExec.length > 1 || !!this.nBreakIns));
    };

    /**
     * checkInstruction(addr, nState)
     *
     * This "check" function is called by the CPU to inform us about the next instruction to be executed,
     * giving us an opportunity to look for "exec" breakpoints and update opcode instruction history.
     *
     * @this {DebuggerPDP11}
     * @param {number} addr
     * @param {number} nState is < 0 if stepping, 0 if starting, or > 0 if running
     * @return {boolean} true if breakpoint hit, false if not
     */
    DebuggerPDP11.prototype.checkInstruction = function(addr, nState)
    {
        var cpu = this.cpu;

        if (nState > 0) {
            if (this.nBreakIns && !--this.nBreakIns) {
                return true;
            }
            if (this.checkBreakpoint(addr, 1, this.aBreakExec)) {
                return true;
            }
        }

        /*
         * The rest of the instruction tracking logic can only be performed if historyInit() has allocated the
         * necessary data structures.  Note that there is no explicit UI for enabling/disabling history, other than
         * adding/removing breakpoints, simply because it's breakpoints that trigger the call to checkInstruction();
         * well, OK, and a few other things now, like enabling MessagesPDP11.INT messages.
         */
        if (nState >= 0 && this.aaOpcodeCounts.length) {
            this.cOpcodes++;
            var opCode = this.bus.getShortDirect(addr);
            if (opCode != null) {
                var dbgAddr = this.aOpcodeHistory[this.iOpcodeHistory];
                this.setAddr(dbgAddr, cpu.getPC());
                if (DEBUG) dbgAddr.cycleCount = cpu.getCycles();
                if (++this.iOpcodeHistory == this.aOpcodeHistory.length) this.iOpcodeHistory = 0;
            }
        }
        return false;
    };

    /**
     * checkMemoryRead(addr, nb)
     *
     * This "check" function is called by a Memory block to inform us that a memory read occurred, giving us an
     * opportunity to track the read if we want, and look for a matching "read" breakpoint, if any.
     *
     * In the "old days", it would be an error for this call to fail to find a matching Debugger breakpoint, but now
     * Memory blocks have no idea whether the Debugger or the machine's Debug register(s) triggered this "checked" read.
     *
     * If we return true, we "trump" the machine's Debug register(s); false allows normal Debug register processing.
     *
     * @this {DebuggerPDP11}
     * @param {number} addr
     * @param {number} [nb] (# of bytes; default is 1)
     * @return {boolean} true if breakpoint hit, false if not
     */
    DebuggerPDP11.prototype.checkMemoryRead = function(addr, nb)
    {
        if (this.checkBreakpoint(addr, nb || 1, this.aBreakRead)) {
            this.stopCPU(true);
            return true;
        }
        return false;
    };

    /**
     * checkMemoryWrite(addr, nb)
     *
     * This "check" function is called by a Memory block to inform us that a memory write occurred, giving us an
     * opportunity to track the write if we want, and look for a matching "write" breakpoint, if any.
     *
     * In the "old days", it would be an error for this call to fail to find a matching Debugger breakpoint, but now
     * Memory blocks have no idea whether the Debugger or the machine's Debug register(s) triggered this "checked" write.
     *
     * If we return true, we "trump" the machine's Debug register(s); false allows normal Debug register processing.
     *
     * @this {DebuggerPDP11}
     * @param {number} addr
     * @param {number} [nb] (# of bytes; default is 1)
     * @return {boolean} true if breakpoint hit, false if not
     */
    DebuggerPDP11.prototype.checkMemoryWrite = function(addr, nb)
    {
        if (this.checkBreakpoint(addr, nb || 1, this.aBreakWrite)) {
            this.stopCPU(true);
            return true;
        }
        return false;
    };

    /**
     * clearBreakpoints()
     *
     * @this {DebuggerPDP11}
     */
    DebuggerPDP11.prototype.clearBreakpoints = function()
    {
        var i, dbgAddr;
        this.aBreakExec = ["bp"];
        if (this.aBreakRead !== undefined) {
            for (i = 1; i < this.aBreakRead.length; i++) {
                dbgAddr = this.aBreakRead[i];
                this.bus.removeMemBreak(this.getAddr(dbgAddr), false);
            }
        }
        this.aBreakRead = ["br"];
        if (this.aBreakWrite !== undefined) {
            for (i = 1; i < this.aBreakWrite.length; i++) {
                dbgAddr = this.aBreakWrite[i];
                this.bus.removeMemBreak(this.getAddr(dbgAddr), true);
            }
        }
        this.aBreakWrite = ["bw"];
        /*
         * nSuppressBreaks ensures we can't get into an infinite loop where a breakpoint lookup requires
         * reading a segment descriptor via getSegment(), and that triggers more memory reads, which triggers
         * more breakpoint checks.
         */
        this.nSuppressBreaks = 0;
    };

    /**
     * addBreakpoint(aBreak, dbgAddr, fTemporary)
     *
     * In case you haven't already figured this out, all our breakpoint commands use the address
     * to identify a breakpoint, not an incrementally assigned breakpoint index like other debuggers;
     * see doBreak() for details.
     *
     * This has a few implications, one being that you CANNOT set more than one kind of breakpoint
     * on a single address.  In practice, that's rarely a problem, because you can almost always set
     * a different breakpoint on a neighboring address.
     *
     * Also, there is one exception to the "one address, one breakpoint" rule, and that involves
     * temporary breakpoints (ie, one-time execution breakpoints that either a "p" or "g" command
     * may create to step over a chunk of code).  Those breakpoints automatically clear themselves,
     * so there usually isn't any need to refer to them using breakpoint commands.
     *
     * TODO: Consider supporting the more "traditional" breakpoint index syntax; the current
     * address-based syntax was implemented solely for expediency and consistency.  At the same time,
     * also consider a more WDEB386-like syntax, where "br" is used to set a variety of access-specific
     * breakpoints, using modifiers like "r1", "r2", "w1", "w2, etc.
     *
     * @this {DebuggerPDP11}
     * @param {Array} aBreak
     * @param {DbgAddrPDP11} dbgAddr
     * @param {boolean} [fTemporary]
     * @return {boolean} true if breakpoint added, false if already exists
     */
    DebuggerPDP11.prototype.addBreakpoint = function(aBreak, dbgAddr, fTemporary)
    {
        var fSuccess = true;

        // this.nSuppressBreaks++;

        /*
         * Instead of complaining that a breakpoint already exists (as we used to do), we now
         * allow breakpoints to be re-set; this makes it easier to update any commands that may
         * be associated with the breakpoint.
         *
         * The only exception: we DO allow a temporary breakpoint at an address where there may
         * already be a breakpoint, so that you can easily step ("p" or "g") over such addresses.
         */
        if (!fTemporary) {
            this.findBreakpoint(aBreak, dbgAddr, true, false, true);
        }

        if (aBreak != this.aBreakExec) {
            var addr = this.getAddr(dbgAddr);
            if (addr === PDP11.ADDR_INVALID) {
                this.println("invalid address: " + this.toHexAddr(dbgAddr));
                fSuccess = false;
            } else {
                this.bus.addMemBreak(addr, aBreak == this.aBreakWrite);
            }
        }

        if (fSuccess) {
            aBreak.push(dbgAddr);
            if (fTemporary) {
                dbgAddr.fTemporary = true;
            }
            else {
                this.printBreakpoint(aBreak, aBreak.length-1, "set");
                this.historyInit();
            }
        }

        // this.nSuppressBreaks--;

        return fSuccess;
    };

    /**
     * findBreakpoint(aBreak, dbgAddr, fRemove, fTemporary, fQuiet)
     *
     * @this {DebuggerPDP11}
     * @param {Array} aBreak
     * @param {DbgAddrPDP11} dbgAddr
     * @param {boolean} [fRemove]
     * @param {boolean} [fTemporary]
     * @param {boolean} [fQuiet]
     * @return {boolean} true if found, false if not
     */
    DebuggerPDP11.prototype.findBreakpoint = function(aBreak, dbgAddr, fRemove, fTemporary, fQuiet)
    {
        var fFound = false;
        var addr = this.getAddr(dbgAddr);
        for (var i = 1; i < aBreak.length; i++) {
            var dbgAddrBreak = aBreak[i];
            if (addr == this.getAddr(dbgAddrBreak)) {
                if (!fTemporary || dbgAddrBreak.fTemporary) {
                    fFound = true;
                    if (fRemove) {
                        if (!dbgAddrBreak.fTemporary && !fQuiet) {
                            this.printBreakpoint(aBreak, i, "cleared");
                        }
                        aBreak.splice(i, 1);
                        if (aBreak != this.aBreakExec) {
                            this.bus.removeMemBreak(addr, aBreak == this.aBreakWrite);
                        }
                        /*
                         * We'll mirror the logic in addBreakpoint() and leave the history buffer alone if this
                         * was a temporary breakpoint.
                         */
                        if (!dbgAddrBreak.fTemporary) {
                            this.historyInit();
                        }
                        break;
                    }
                    if (!fQuiet) this.printBreakpoint(aBreak, i, "exists");
                    break;
                }
            }
        }
        return fFound;
    };

    /**
     * listBreakpoints(aBreak)
     *
     * @this {DebuggerPDP11}
     * @param {Array} aBreak
     * @return {number} of breakpoints listed, 0 if none
     */
    DebuggerPDP11.prototype.listBreakpoints = function(aBreak)
    {
        for (var i = 1; i < aBreak.length; i++) {
            this.printBreakpoint(aBreak, i);
        }
        return aBreak.length - 1;
    };

    /**
     * printBreakpoint(aBreak, i, sAction)
     *
     * @this {DebuggerPDP11}
     * @param {Array} aBreak
     * @param {number} i
     * @param {string} [sAction]
     */
    DebuggerPDP11.prototype.printBreakpoint = function(aBreak, i, sAction)
    {
        var dbgAddr = aBreak[i];
        this.println(aBreak[0] + ' ' + this.toHexAddr(dbgAddr) + (sAction? (' ' + sAction) : (dbgAddr.sCmd? (' "' + dbgAddr.sCmd + '"') : '')));
    };

    /**
     * setTempBreakpoint(dbgAddr)
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr of new temp breakpoint
     */
    DebuggerPDP11.prototype.setTempBreakpoint = function(dbgAddr)
    {
        this.addBreakpoint(this.aBreakExec, dbgAddr, true);
    };

    /**
     * clearTempBreakpoint(addr)
     *
     * @this {DebuggerPDP11}
     * @param {number|undefined} [addr] clear all temp breakpoints if no address specified
     */
    DebuggerPDP11.prototype.clearTempBreakpoint = function(addr)
    {
        if (addr !== undefined) {
            this.checkBreakpoint(addr, 1, this.aBreakExec, true);
            this.nStep = 0;
        } else {
            for (var i = 1; i < this.aBreakExec.length; i++) {
                var dbgAddrBreak = this.aBreakExec[i];
                if (dbgAddrBreak.fTemporary) {
                    if (!this.findBreakpoint(this.aBreakExec, dbgAddrBreak, true, true)) break;
                    i = 0;
                }
            }
        }
    };

    /**
     * checkBreakpoint(addr, nb, aBreak, fTemporary)
     *
     * @this {DebuggerPDP11}
     * @param {number} addr
     * @param {number} nb (# of bytes)
     * @param {Array} aBreak
     * @param {boolean} [fTemporary]
     * @return {boolean} true if breakpoint has been hit, false if not
     */
    DebuggerPDP11.prototype.checkBreakpoint = function(addr, nb, aBreak, fTemporary)
    {
        /*
         * Time to check for execution breakpoints; note that this should be done BEFORE updating
         * history data (see checkInstruction), since we might not actually execute the current instruction.
         */
        var fBreak = false;

        if (!this.nSuppressBreaks++) {

            for (var i = 1; !fBreak && i < aBreak.length; i++) {

                var dbgAddrBreak = aBreak[i];

                if (fTemporary && !dbgAddrBreak.fTemporary) continue;

                /*
                 * We used to calculate the linear address of the breakpoint at the time the
                 * breakpoint was added, so that a breakpoint set in one mode (eg, in real-mode)
                 * would still work as intended if the mode changed later (eg, to protected-mode).
                 *
                 * However, that created difficulties setting protected-mode breakpoints in segments
                 * that might not be defined yet, or that could move in physical memory.
                 *
                 * If you want to create a real-mode breakpoint that will break regardless of mode,
                 * use the physical address of the real-mode memory location instead.
                 */
                var addrBreak = this.getAddr(dbgAddrBreak);
                for (var n = 0; n < nb; n++) {
                    if (addr + n == addrBreak) {
                        var a;
                        fBreak = true;
                        if (dbgAddrBreak.fTemporary) {
                            this.findBreakpoint(aBreak, dbgAddrBreak, true, true);
                            fTemporary = true;
                        }
                        if (a = dbgAddrBreak.aCmds) {
                            /*
                             * When one or more commands are attached to a breakpoint, we don't halt by default.
                             * Instead, we set fBreak to true only if, at the completion of all the commands, the
                             * CPU is halted; in other words, you should include "h" as one of the breakpoint commands
                             * if you want the breakpoint to stop execution.
                             *
                             * Another useful command is "if", which will return false if the expression is false,
                             * at which point we'll jump ahead to the next "else" command, and if there isn't an "else",
                             * we abort.
                             */
                            fBreak = false;
                            for (var j = 0; j < a.length; j++) {
                                if (!this.doCommand(a[j], true)) {
                                    if (a[j].indexOf("if")) {
                                        fBreak = true;          // the failed command wasn't "if", so abort
                                        break;
                                    }
                                    var k = j + 1;
                                    for (; k < a.length; k++) {
                                        if (!a[k].indexOf("else")) break;
                                        j++;
                                    }
                                    if (k == a.length) {        // couldn't find an "else" after the "if", so abort
                                        fBreak = true;
                                        break;
                                    }
                                    /*
                                     * If we're still here, we'll execute the "else" command (which is just a no-op),
                                     * followed by any remaining commands.
                                     */
                                }
                            }
                            if (!this.cpu.isRunning()) fBreak = true;
                        }
                        if (fBreak) {
                            if (!fTemporary) this.printBreakpoint(aBreak, i, "hit");
                            break;
                        }
                    }
                }
            }
        }

        this.nSuppressBreaks--;

        return fBreak;
    };

    /**
     * getInstruction(dbgAddr, sComment, nSequence)
     *
     * Get the next instruction, by decoding the opcode and any operands.
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {string} [sComment] is an associated comment
     * @param {number} [nSequence] is an associated sequence number, undefined if none
     * @return {string} (and dbgAddr is updated to the next instruction)
     */
    DebuggerPDP11.prototype.getInstruction = function(dbgAddr, sComment, nSequence)
    {
        var opNames = DebuggerPDP11.OPNAMES;
        var dbgAddrOp = this.newAddr(dbgAddr.addr);
        var opCode = this.getWord(dbgAddr, true);

        var opDesc;
        for (var mask in this.opMasks) {
            var opMask = this.opMasks[mask];
            var bits = opCode & mask;
            opDesc = opMask[bits];
            if (opDesc) break;
        }
        if (!opDesc) opDesc = [DebuggerPDP11.OPS.NONE];

        var sOperands = "";
        var sOpName = opNames[opDesc[0]];
        var cOperands = opDesc.length - 1;

        for (var iOperand = 1; iOperand <= cOperands; iOperand++) {

            var type = opDesc[iOperand];
            if (type === undefined) continue;

            var sOperand = this.getOperand(opCode, type, dbgAddr);

            if (!sOperand || !sOperand.length) {
                sOperands = "INVALID";
                break;
            }

            if (sOperands.length > 0) sOperands += ',';
            sOperands += (sOperand || "???");
        }

        var sBytes = "";
        var sLine = this.toHexAddr(dbgAddrOp) + ' ';
        if (dbgAddrOp.addr !== PDP11.ADDR_INVALID && dbgAddr.addr !== PDP11.ADDR_INVALID) {
            do {
                sBytes += str.toHex(this.getByte(dbgAddrOp, 1), 2);
                if (dbgAddrOp.addr == null) break;
            } while (dbgAddrOp.addr != dbgAddr.addr);
        }

        sLine += str.pad(sBytes, 10);
        sLine += str.pad(sOpName, 7);
        if (sOperands) sLine += ' ' + sOperands;

        if (sComment) {
            sLine = str.pad(sLine, 40) + ';' + sComment;
            if (!this.cpu.flags.checksum) {
                sLine += (nSequence != null? '=' + nSequence.toString() : "");
            } else {
                var nCycles = this.cpu.getCycles();
                sLine += "cycles=" + nCycles.toString() + " cs=" + str.toHex(this.cpu.nChecksum);
            }
        }
        return sLine;
    };

    /**
     * getOperand(opCode, type, dbgAddr)
     *
     * @this {DebuggerPDP11}
     * @param {number} opCode
     * @param {number} type
     * @param {DbgAddrPDP11} dbgAddr
     * @return {string} operand
     */
    DebuggerPDP11.prototype.getOperand = function(opCode, type, dbgAddr)
    {
        var sOperand = "";
        if (type & DebuggerPDP11.TYPE_BRANCH) {
            var disp = ((opCode & 0xff) << 24) >> 24;
            var addr = (dbgAddr.addr + disp) & 0xffff;
            sOperand = str.toHexWord(addr);
        }
        else {
            /*
             * Isolate all SRC or DST bits from opcode in the mode variable.
             */
            var mode = opCode & type;
            /*
             * Convert SRC bits into DST bits, since they use the same format.
             */
            if (type & DebuggerPDP11.TYPE_SRC) {
                mode >>= 6;
                type >>= 6;
            }
            if (type & DebuggerPDP11.TYPE_DST) {
                var wIndex;
                var reg = mode & DebuggerPDP11.TYPE_DSTREG;
                /*
                 * Note that opcodes that specify only REG bits in the type mask (ie, no MOD bits)
                 * will automatically default to MODE_REG below.
                 */
                switch(mode & DebuggerPDP11.TYPE_DSTMOD) {
                case DebuggerPDP11.MODE_REG:            // 0x0: REGISTER
                    sOperand = "R" + reg;
                    break;
                case DebuggerPDP11.MODE_REGD:           // 0x1: REGISTER DEFERRED
                    sOperand = "@R" + reg;
                    break;
                case DebuggerPDP11.MODE_POSTINC:        // 0x2: POST-INCREMENT
                    if (reg < 7) {
                        sOperand = "(R" + reg + ")+";
                    } else {
                        /*
                         * When using R7 (aka PC), POST-INCREMENT is known as IMMEDIATE
                         */
                        wIndex = this.getWord(dbgAddr, true);
                        sOperand = "#" + str.toHexWord(wIndex);
                    }
                    break;
                case DebuggerPDP11.MODE_POSTINCD:       // 0x3: POST-INCREMENT DEFERRED
                    if (reg < 7) {
                        sOperand = "@(R" + reg + ")+";
                    } else {
                        /*
                         * When using R7 (aka PC), POST-INCREMENT DEFERRED is known as ABSOLUTE
                         */
                        wIndex = this.getWord(dbgAddr, true);
                        sOperand = "@#" + str.toHexWord(wIndex);
                    }
                    break;
                case DebuggerPDP11.MODE_PREDEC:         // 0x4: PRE-DECREMENT
                    sOperand = "-(R" + reg + ")";
                    break;
                case DebuggerPDP11.MODE_PREDECD:        // 0x5: PRE-DECREMENT DEFERRED
                    sOperand = "@-R(" + reg + ")";
                    break;
                case DebuggerPDP11.MODE_INDEX:          // 0x6: INDEX
                    wIndex = this.getWord(dbgAddr, true);
                    /*
                     * When using R7 (aka PC), INDEX is known as RELATIVE
                     */
                    sOperand = str.toHexWord(wIndex) + (reg < 7? "(R" + reg + ")" : "(PC)");
                    break;
                case DebuggerPDP11.MODE_INDEXD:         // 0x7: INDEX DEFERRED
                    wIndex = this.getWord(dbgAddr, true);
                    /*
                     * When using R7 (aka PC), INDEX DEFERRED is known as RELATIVE DEFERRED
                     */
                    sOperand = '@' + str.toHexWord(wIndex) + (reg < 7? "(R" + reg + ")" : "(PC)");
                    break;
                }
            }
        }
        return sOperand;
    };

    /**
     * getRegOperand(iReg, type, dbgAddr)
     *
     * @this {DebuggerPDP11}
     * @param {number} iReg
     * @param {number} type
     * @param {DbgAddrPDP11} dbgAddr
     * @return {string} operand
     */
    DebuggerPDP11.prototype.getRegOperand = function(iReg, type, dbgAddr)
    {
        return DebuggerPDP11.REGS[iReg];
    };

    /**
     * parseInstruction(sOp, sOperand, addr)
     *
     * TODO: Unimplemented.  See parseInstruction() in modules/c1pjs/lib/debugger.js for a working implementation.
     *
     * @this {DebuggerPDP11}
     * @param {string} sOp
     * @param {string|undefined} sOperand
     * @param {DbgAddrPDP11} dbgAddr of memory where this instruction is being assembled
     * @return {Array.<number>} of opcode bytes; if the instruction can't be parsed, the array will be empty
     */
    DebuggerPDP11.prototype.parseInstruction = function(sOp, sOperand, dbgAddr)
    {
        var aOpBytes = [];
        this.println("not supported yet");
        return aOpBytes;
    };

    /**
     * getFlagOutput(sFlag)
     *
     * @this {DebuggerPDP11}
     * @param {string} sFlag
     * @return {string} value of flag
     */
    DebuggerPDP11.prototype.getFlagOutput = function(sFlag)
    {
        var b;
        switch (sFlag) {
        case "SF":
            b = this.cpu.getSF();
            break;
        case "ZF":
            b = this.cpu.getZF();
            break;
        case "CF":
            b = this.cpu.getCF();
            break;
        default:
            b = 0;
            break;
        }
        return sFlag.charAt(0) + (b? '1' : '0') + ' ';
    };

    /**
     * getRegOutput(iReg)
     *
     * @this {DebuggerPDP11}
     * @param {number} iReg
     * @return {string}
     */
    DebuggerPDP11.prototype.getRegOutput = function(iReg)
    {
        var sReg = DebuggerPDP11.REGS[iReg];
        return sReg + '=' + this.getRegString(iReg) + ' ';
    };

    /**
     * getRegDump()
     *
     * @this {DebuggerPDP11}
     * @return {string}
     */
    DebuggerPDP11.prototype.getRegDump = function()
    {
        return "no regs";
    };

    /**
     * comparePairs(p1, p2)
     *
     * @this {DebuggerPDP11}
     * @param {number|string|Array|Object} p1
     * @param {number|string|Array|Object} p2
     * @return {number}
     */
    DebuggerPDP11.prototype.comparePairs = function(p1, p2)
    {
        return p1[0] > p2[0]? 1 : p1[0] < p2[0]? -1 : 0;
    };

    /**
     * addSymbols(sModule, addr, len, aSymbols)
     *
     * As filedump.js (formerly convrom.php) explains, aSymbols is a JSON-encoded object whose properties consist
     * of all the symbols (in upper-case), and the values of those properties are objects containing any or all of
     * the following properties:
     *
     *      'v': the value of an absolute (unsized) value
     *      'b': either 1, 2, 4 or undefined if an unsized value
     *      's': either a hard-coded segment or undefined
     *      'o': the offset of the symbol within the associated address space
     *      'l': the original-case version of the symbol, present only if it wasn't originally upper-case
     *      'a': annotation for the specified offset; eg, the original assembly language, with optional comment
     *
     * To that list of properties, we also add:
     *
     *      'p': the physical address (calculated whenever both 's' and 'o' properties are defined)
     *
     * Note that values for any 'v', 'b', 's' and 'o' properties are unquoted decimal values, and the values
     * for any 'l' or 'a' properties are quoted strings. Also, if double-quotes were used in any of the original
     * annotation ('a') values, they will have been converted to two single-quotes, so we're responsible for
     * converting them back to individual double-quotes.
     *
     * For example:
     *      {
     *          'HF_PORT': {
     *              'v':800
     *          },
     *          'HDISK_INT': {
     *              'b':4, 's':0, 'o':52
     *          },
     *          'ORG_VECTOR': {
     *              'b':4, 's':0, 'o':76
     *          },
     *          'CMD_BLOCK': {
     *              'b':1, 's':64, 'o':66
     *          },
     *          'DISK_SETUP': {
     *              'o':3
     *          },
     *          '.40': {
     *              'o':40, 'a':"MOV AX,WORD PTR ORG_VECTOR ;GET DISKETTE VECTOR"
     *          }
     *      }
     *
     * If a symbol only has an offset, then that offset value can be assigned to the symbol property directly:
     *
     *          'DISK_SETUP': 3
     *
     * The last property is an example of an "anonymous" entry, for offsets where there is no associated symbol.
     * Such entries are identified by a period followed by a unique number (usually the offset of the entry), and
     * they usually only contain offset ('o') and annotation ('a') properties.  I could eliminate the leading
     * period, but it offers a very convenient way of quickly discriminating among genuine vs. anonymous symbols.
     *
     * We add all these entries to our internal symbol table, which is an array of 4-element arrays, each of which
     * look like:
     *
     *      [addr, len, aSymbols, aOffsets]
     *
     * There are two basic symbol operations: findSymbol(), which takes an address and finds the symbol, if any,
     * at that address, and findSymbolAddr(), which takes a string and attempts to match it to a non-anonymous
     * symbol with a matching offset ('o') property.
     *
     * To implement findSymbol() efficiently, addSymbols() creates an array of [offset, sSymbol] pairs
     * (aOffsets), one pair for each symbol that corresponds to an offset within the specified address space.
     *
     * We guarantee the elements of aOffsets are in offset order, because we build it using binaryInsert();
     * it's quite likely that the MAP file already ordered all its symbols in offset order, but since they're
     * hand-edited files, we can't assume that, and we need to ensure that findSymbol()'s binarySearch() operates
     * properly.
     *
     * @this {DebuggerPDP11}
     * @param {string|null} sModule
     * @param {number|null} addr (physical address where the symbols are located, if the memory is physical; eg, ROM)
     * @param {number} len (the size of the region, in bytes)
     * @param {Object} aSymbols (collection of symbols in this group; the format of this collection is described below)
     */
    DebuggerPDP11.prototype.addSymbols = function(sModule, addr, len, aSymbols)
    {
        var dbgAddr = {};
        var aOffsets = [];
        for (var sSymbol in aSymbols) {
            var symbol = aSymbols[sSymbol];
            if (typeof symbol == "number") {
                aSymbols[sSymbol] = symbol = {'o': symbol};
            }
            var offSymbol = symbol['o'];
            var sAnnotation = symbol['a'];
            if (offSymbol !== undefined) {
                usr.binaryInsert(aOffsets, [offSymbol >>> 0, sSymbol], this.comparePairs);
            }
            if (sAnnotation) symbol['a'] = sAnnotation.replace(/''/g, "\"");
        }
        var symbolTable = {
            sModule: sModule,
            addr: addr,
            len: len,
            aSymbols: aSymbols,
            aOffsets: aOffsets
        };
        this.aSymbolTable.push(symbolTable);
    };

    /**
     * dumpSymbols()
     *
     * TODO: Add "numerical" and "alphabetical" dump options. This is simply dumping them in whatever
     * order they appeared in the original MAP file.
     *
     * @this {DebuggerPDP11}
     */
    DebuggerPDP11.prototype.dumpSymbols = function()
    {
        for (var iTable = 0; iTable < this.aSymbolTable.length; iTable++) {
            var symbolTable = this.aSymbolTable[iTable];
            for (var sSymbol in symbolTable.aSymbols) {
                if (sSymbol.charAt(0) == '.') continue;
                var symbol = symbolTable.aSymbols[sSymbol];
                var offSymbol = symbol['o'];
                if (offSymbol === undefined) continue;
                var sSymbolOrig = symbolTable.aSymbols[sSymbol]['l'];
                if (sSymbolOrig) sSymbol = sSymbolOrig;
                this.println(this.toHexOffset(offSymbol) + ' ' + sSymbol);
            }
        }
    };

    /**
     * findSymbol(dbgAddr, fNearest)
     *
     * Search aSymbolTable for dbgAddr, and return an Array for the corresponding symbol (empty if not found).
     *
     * If fNearest is true, and no exact match was found, then the Array returned will contain TWO sets of
     * entries: [0]-[3] will refer to closest preceding symbol, and [4]-[7] will refer to the closest subsequent symbol.
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @param {boolean} [fNearest]
     * @return {Array} where [0] == symbol name, [1] == symbol value, [2] == any annotation, and [3] == any associated comment
     */
    DebuggerPDP11.prototype.findSymbol = function(dbgAddr, fNearest)
    {
        var aSymbol = [];
        var addrSymbol = this.getAddr(dbgAddr) >>> 0;
        for (var iTable = 0; iTable < this.aSymbolTable.length; iTable++) {
            var symbolTable = this.aSymbolTable[iTable];
            var addr = symbolTable.addr >>> 0;
            var len = symbolTable.len;
            if (addrSymbol >= addr && addrSymbol < addr + len) {
                var offSymbol = addrSymbol - addr;
                var result = usr.binarySearch(symbolTable.aOffsets, [offSymbol], this.comparePairs);
                if (result >= 0) {
                    this.returnSymbol(iTable, result, aSymbol);
                }
                else if (fNearest) {
                    result = ~result;
                    this.returnSymbol(iTable, result-1, aSymbol);
                    this.returnSymbol(iTable, result, aSymbol);
                }
                break;
            }
        }
        return aSymbol;
    };

    /**
     * findSymbolAddr(sSymbol)
     *
     * Search aSymbolTable for sSymbol, and if found, return a dbgAddr (same as parseAddr())
     *
     * @this {DebuggerPDP11}
     * @param {string} sSymbol
     * @return {DbgAddrPDP11|undefined}
     */
    DebuggerPDP11.prototype.findSymbolAddr = function(sSymbol)
    {
        var dbgAddr;
        if (sSymbol.match(/^[a-z_][a-z0-9_]*$/i)) {
            var sUpperCase = sSymbol.toUpperCase();
            for (var iTable = 0; iTable < this.aSymbolTable.length; iTable++) {
                var symbolTable = this.aSymbolTable[iTable];
                var symbol = symbolTable.aSymbols[sUpperCase];
                if (symbol !== undefined) {
                    var offSymbol = symbol['o'];
                    if (offSymbol !== undefined) {
                        /*
                         * We assume that every ROM is ORG'ed at 0x0000, and therefore unless the symbol has an
                         * explicitly-defined segment, we return the segment associated with the entire group; for
                         * a ROM, that segment is normally "addrROM >>> 4".  Down the road, we may want/need to
                         * support a special symbol entry (eg, ".ORG") that defines an alternate origin.
                         */
                        dbgAddr = this.newAddr(offSymbol);
                    }
                    /*
                     * The symbol matched, but it wasn't for an address (no 'o' offset), and there's no point
                     * looking any farther, since each symbol appears only once, so we indicate it's an unknown symbol.
                     */
                    break;
                }
            }
        }
        return dbgAddr;
    };

    /**
     * returnSymbol(iTable, iOffset, aSymbol)
     *
     * Helper function for findSymbol().
     *
     * @param {number} iTable
     * @param {number} iOffset
     * @param {Array} aSymbol is updated with the specified symbol, if it exists
     */
    DebuggerPDP11.prototype.returnSymbol = function(iTable, iOffset, aSymbol)
    {
        var symbol = {};
        var aOffsets = this.aSymbolTable[iTable].aOffsets;
        var offset = 0, sSymbol = null;
        if (iOffset >= 0 && iOffset < aOffsets.length) {
            offset = aOffsets[iOffset][0];
            sSymbol = aOffsets[iOffset][1];
        }
        if (sSymbol) {
            symbol = this.aSymbolTable[iTable].aSymbols[sSymbol];
            sSymbol = (sSymbol.charAt(0) == '.'? null : (symbol['l'] || sSymbol));
        }
        aSymbol.push(sSymbol);
        aSymbol.push(offset);
        aSymbol.push(symbol['a']);
        aSymbol.push(symbol['c']);
    };

    /**
     * doHelp()
     *
     * @this {DebuggerPDP11}
     */
    DebuggerPDP11.prototype.doHelp = function()
    {
        var s = "commands:";
        for (var sCommand in DebuggerPDP11.COMMANDS) {
            s += '\n' + str.pad(sCommand, 9) + DebuggerPDP11.COMMANDS[sCommand];
        }
        if (!this.checksEnabled()) s += "\nnote: history disabled if no exec breakpoints";
        this.println(s);
    };

    /**
     * doAssemble(asArgs)
     *
     * This always receives the complete argument array, where the order of the arguments is:
     *
     *      [0]: the assemble command (assumed to be "a")
     *      [1]: the target address (eg, "200")
     *      [2]: the operation code, aka instruction name (eg, "adc")
     *      [3]: the operation mode operand, if any (eg, "14", "[1234]", etc)
     *
     * The Debugger enters "assemble mode" whenever only the first (or first and second) arguments are present.
     * As long as "assemble mode is active, the user can omit the first two arguments on all later assemble commands
     * until "assemble mode" is cancelled with an empty command line; the command processor automatically prepends "a"
     * and the next available target address to the argument array.
     *
     * Entering "assemble mode" is optional; one could enter a series of fully-qualified assemble commands; eg:
     *
     *      a ff00 cld
     *      a ff01 ldx 28
     *      ...
     *
     * without ever entering "assemble mode", but of course, that requires more typing and doesn't take advantage
     * of automatic target address advancement (see dbgAddrAssemble).
     *
     * NOTE: As the previous example implies, you can even assemble new instructions into ROM address space;
     * as our setByte() function explains, the ROM write-notification handlers only refuse writes from the CPU.
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs is the complete argument array, beginning with the "a" command in asArgs[0]
     */
    DebuggerPDP11.prototype.doAssemble = function(asArgs)
    {
        var dbgAddr = this.parseAddr(asArgs[1], true);
        if (!dbgAddr) return;

        this.dbgAddrAssemble = dbgAddr;
        if (asArgs[2] === undefined) {
            this.println("begin assemble at " + this.toHexAddr(dbgAddr));
            this.fAssemble = true;
            this.cpu.updateCPU();
            return;
        }

        var aOpBytes = this.parseInstruction(asArgs[2], asArgs[3], dbgAddr);
        if (aOpBytes.length) {
            for (var i = 0; i < aOpBytes.length; i++) {
                this.setByte(dbgAddr, aOpBytes[i], 1);
            }
            /*
             * Since getInstruction() also updates the specified address, dbgAddrAssemble is automatically advanced.
             */
            this.println(this.getInstruction(this.dbgAddrAssemble));
        }
    };

    /**
     * doBreak(sCmd, sAddr, sOptions)
     *
     * As the "help" output below indicates, the following breakpoint commands are supported:
     *
     *      bp [a]  set exec breakpoint on linear addr [a]
     *      br [a]  set read breakpoint on linear addr [a]
     *      bw [a]  set write breakpoint on linear addr [a]
     *      bc [a]  clear breakpoint on linear addr [a] (use "*" for all breakpoints)
     *      bl      list breakpoints
     *
     * to which we have recently added the following I/O breakpoint commands:
     *
     *      bi [p]  toggle input breakpoint on port [p] (use "*" for all input ports)
     *      bo [p]  toggle output breakpoint on port [p] (use "*" for all output ports)
     *
     * These two new commands operate as toggles so that if "*" is used to trap all input (or output),
     * you can also use these commands to NOT trap specific ports.
     *
     *      bn [n]  break after [n] instructions
     *
     * TODO: Update the "bl" command to include any/all I/O breakpoints, and the "bc" command to
     * clear them.  Because "bi" and "bo" commands are piggy-backing on Bus functions, those breakpoints
     * are currently outside the realm of what the "bl" and "bc" commands are aware of.
     *
     * @this {DebuggerPDP11}
     * @param {string} sCmd
     * @param {string|undefined} [sAddr]
     * @param {string} [sOptions] (the rest of the breakpoint command-line)
     */
    DebuggerPDP11.prototype.doBreak = function(sCmd, sAddr, sOptions)
    {
        if (sAddr == '?') {
            this.println("breakpoint commands:");
            this.println("\tbp [a]\tset exec breakpoint at addr [a]");
            this.println("\tbr [a]\tset read breakpoint at addr [a]");
            this.println("\tbw [a]\tset write breakpoint at addr [a]");
            this.println("\tbc [a]\tclear breakpoint at addr [a]");
            this.println("\tbl\tlist all breakpoints");
            this.println("\tbn [n]\tbreak after [n] instruction(s)");
            return;
        }

        var sParm = sCmd.charAt(1);
        if (sParm == 'l') {
            var cBreaks = 0;
            cBreaks += this.listBreakpoints(this.aBreakExec);
            cBreaks += this.listBreakpoints(this.aBreakRead);
            cBreaks += this.listBreakpoints(this.aBreakWrite);
            if (!cBreaks) this.println("no breakpoints");
            return;
        }

        if (sParm == 'n') {
            this.nBreakIns = this.parseValue(sAddr);
            this.println("break after " + this.nBreakIns + " instruction(s)");
            return;
        }

        if (sAddr === undefined) {
            this.println("missing breakpoint address");
            return;
        }

        var dbgAddr = this.newAddr();
        if (sAddr != '*') {
            dbgAddr = this.parseAddr(sAddr, true, true);
            if (!dbgAddr) return;
        }

        if (sParm == 'c') {
            if (dbgAddr.addr == null) {
                this.clearBreakpoints();
                this.println("all breakpoints cleared");
                return;
            }
            if (this.findBreakpoint(this.aBreakExec, dbgAddr, true))
                return;
            if (this.findBreakpoint(this.aBreakRead, dbgAddr, true))
                return;
            if (this.findBreakpoint(this.aBreakWrite, dbgAddr, true))
                return;
            this.println("breakpoint missing: " + this.toHexAddr(dbgAddr));
            return;
        }

        if (dbgAddr.addr == null) return;

        this.parseAddrOptions(dbgAddr, sOptions);

        if (sParm == 'p') {
            this.addBreakpoint(this.aBreakExec, dbgAddr);
            return;
        }
        if (sParm == 'r') {
            this.addBreakpoint(this.aBreakRead, dbgAddr);
            return;
        }
        if (sParm == 'w') {
            this.addBreakpoint(this.aBreakWrite, dbgAddr);
            return;
        }
        this.println("unknown breakpoint command: " + sParm);
    };

    /**
     * doClear(sCmd)
     *
     * @this {DebuggerPDP11}
     * @param {string} [sCmd] (eg, "cls" or "clear")
     */
    DebuggerPDP11.prototype.doClear = function(sCmd)
    {
        /*
         * TODO: There should be a clear() component method that the Control Panel overrides to perform this function.
         */
        if (this.controlPrint) this.controlPrint.value = "";
    };

    /**
     * doDump(asArgs)
     *
     * The length parameter is interpreted as a number of bytes, in hex, which we convert to the appropriate number
     * of lines, because we always display whole lines.  If the length is omitted/undefined, it defaults to 0x80 (128.)
     * bytes, which normally translates to 8 lines.
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs (formerly sCmd, [sAddr], [sLen] and [sBytes])
     */
    DebuggerPDP11.prototype.doDump = function(asArgs)
    {
        var m;
        var sCmd = asArgs[0];
        var sAddr = asArgs[1];
        var sLen = asArgs[2];
        var sBytes = asArgs[3];

        if (sAddr == '?') {
            var sDumpers = "";
            for (m in MessagesPDP11.CATEGORIES) {
                if (this.afnDumpers[m]) {
                    if (sDumpers) sDumpers += ',';
                    sDumpers = sDumpers + m;
                }
            }
            sDumpers += ",state,symbols";
            this.println("dump memory commands:");
            this.println("\tdb [a] [#]    dump # bytes at address a");
            this.println("\tdw [a] [#]    dump # words at address a");
            this.println("\tdd [a] [#]    dump # dwords at address a");
            this.println("\tdh [#] [#]    dump # instructions from history");
            if (sDumpers.length) this.println("dump extension commands:\n\t" + sDumpers);
            return;
        }

        if (sAddr == "state") {
            var sState = this.cmp.powerOff(true);
            if (sLen == "console") {
                /*
                 * Console buffers are notoriously small, and even the following code, which breaks the
                 * data into parts (eg, "d state console 1", "d state console 2", etc) just isn't that helpful.
                 *
                 *      var nPart = +sBytes;
                 *      if (nPart) sState = sState.substr(1000000 * (nPart-1), 1000000);
                 *
                 * So, the best way to capture a large machine state is to use the new "Save Machine" link
                 * that downloads a machine's entire state.  Alternatively, run your own local server and use
                 * server-side storage.  Take a look at the "Save" binding in computer.js, which binds an HTML
                 * control to the computer.powerOff() and computer.saveServerState() functions.
                 */
                console.log(sState);
            } else {
                this.doClear();
                this.println(sState);
            }
            return;
        }

        if (sAddr == "symbols") {
            this.dumpSymbols();
            return;
        }

        if (sCmd == "d") {
            for (m in MessagesPDP11.CATEGORIES) {
                if (asArgs[1] == m) {
                    var fnDumper = this.afnDumpers[m];
                    if (fnDumper) {
                        asArgs.shift();
                        asArgs.shift();
                        fnDumper(asArgs);
                    } else {
                        this.println("no dump registered for " + sAddr);
                    }
                    return;
                }
            }
            if (!sAddr) sCmd = this.sCmdDumpPrev || "db";
        } else {
            this.sCmdDumpPrev = sCmd;
        }

        if (sCmd == "dh") {
            this.dumpHistory(sAddr, sLen);
            return;
        }

        var dbgAddr = this.parseAddr(sAddr);
        if (!dbgAddr) return;

        var len = 0;                            // 0 is not a default; it triggers the appropriate default below
        if (sLen) {
            if (sLen.charAt(0) == 'l') {
                sLen = sLen.substr(1) || sBytes;
            }
            len = this.parseValue(sLen) >>> 0;  // negative lengths not allowed
            if (len > 0x10000) len = 0x10000;   // prevent bad user (or variable) input from producing excessive output
        }

        var sDump = "";
        var size = (sCmd == "dd"? 4 : (sCmd == "dw"? 2 : 1));
        var cb = (size * len) || 128;
        var cLines = ((cb + 15) >> 4) || 1;

        while (cLines-- && cb > 0) {
            var data = 0, iByte = 0, i;
            var sData = "", sChars = "";
            sAddr = this.toHexAddr(dbgAddr);
            for (i = 16; i > 0 && cb > 0; i--) {
                var b = this.getByte(dbgAddr, 1);
                data |= (b << (iByte++ << 3));
                if (iByte == size) {
                    sData += str.toHex(data, size * 2);
                    sData += (size == 1? (i == 9? '-' : ' ') : "  ");
                    data = iByte = 0;
                }
                sChars += (b >= 32 && b < 128? String.fromCharCode(b) : '.');
                cb--;
            }
            if (sDump) sDump += '\n';
            sDump += sAddr + "  " + sData + ((i == 0)? (' ' + sChars) : "");
        }

        if (sDump) this.println(sDump);
        this.dbgAddrNextData = dbgAddr;
    };

    /**
     * doEdit(asArgs)
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs
     */
    DebuggerPDP11.prototype.doEdit = function(asArgs)
    {
        var size = 1;
        var mask = 0xff;
        var fnGet = this.getByte;
        var fnSet = this.setByte;
        if (asArgs[0] == "ew") {
            size = 2;
            mask = 0xffff;
            fnGet = this.getShort;
            fnSet = this.setShort;
        }
        var cch = size << 1;

        var sAddr = asArgs[1];
        if (sAddr == null) {
            this.println("edit memory commands:");
            this.println("\teb [a] [...]  edit bytes at address a");
            this.println("\tew [a] [...]  edit words at address a");
            return;
        }

        var dbgAddr = this.parseAddr(sAddr);
        if (!dbgAddr) return;

        for (var i = 2; i < asArgs.length; i++) {
            var vNew = this.parseExpression(asArgs[i]);
            if (vNew === undefined) {
                this.println("unrecognized value: " + asArgs[i]);
                break;
            }
            if (vNew & ~mask) {
                this.println("warning: " + str.toHex(vNew) + " exceeds " + size + "-byte value");
            }
            var vOld = fnGet.call(this, dbgAddr);
            this.println("changing " + this.toHexAddr(dbgAddr) + " from " + str.toHex(vOld, cch, true) + " to " + str.toHex(vNew, cch, true));
            fnSet.call(this, dbgAddr, vNew, size);
        }
    };

    /**
     * doHalt(fQuiet)
     *
     * @this {DebuggerPDP11}
     * @param {boolean} [fQuiet]
     */
    DebuggerPDP11.prototype.doHalt = function(fQuiet)
    {
        var sMsg;
        if (this.flags.running) {
            sMsg = "halting";
            this.stopCPU();
        } else {
            if (this.isBusy(true)) return;
            sMsg = "already halted";
        }
        if (!fQuiet) this.println(sMsg);
    };

    /**
     * doIf(sCmd, fQuiet)
     *
     * NOTE: Don't forget that the default base for all numeric constants is 16 (hex), so when you evaluate
     * an expression like "a==10", it will compare the value of the variable "a" to 0x10; use a trailing period
     * (eg, "10.") if you really intend decimal.
     *
     * Also, if no variable named "a" exists, "a" will evaluate to 0x0A, so the expression "a==10" becomes
     * "0x0A==0x10" (false), whereas the expression "a==10." becomes "0x0A==0x0A" (true).
     *
     * @this {DebuggerPDP11}
     * @param {string} sCmd
     * @param {boolean} [fQuiet]
     * @return {boolean} true if expression is non-zero, false if zero (or undefined due to a parse error)
     */
    DebuggerPDP11.prototype.doIf = function(sCmd, fQuiet)
    {
        sCmd = str.trim(sCmd);
        if (!this.parseExpression(sCmd)) {
            if (!fQuiet) this.println("false: " + sCmd);
            return false;
        }
        if (!fQuiet) this.println("true: " + sCmd);
        return true;
    };

    /**
     * doInfo(asArgs)
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs
     * @return {boolean} true only if the instruction info command ("n") is supported
     */
    DebuggerPDP11.prototype.doInfo = function(asArgs)
    {
        if (DEBUG) {
            this.println("msPerYield: " + this.cpu.msPerYield);
            this.println("nCyclesPerYield: " + this.cpu.nCyclesPerYield);
            return true;
        }
        return false;
    };

    /**
     * doVar(sCmd)
     *
     * The command must be of the form "{variable} = [{expression}]", where expression may contain constants,
     * operators, registers, symbols, other variables, or nothing at all; in the latter case, the variable, if
     * any, is deleted.
     *
     * Other supported shorthand: "var" with no parameters prints the values of all variables, and "var {variable}"
     * prints the value of the specified variable.
     *
     * @this {DebuggerPDP11}
     * @param {string} sCmd
     * @return {boolean} true if valid "var" assignment, false if not
     */
    DebuggerPDP11.prototype.doVar = function(sCmd)
    {
        var a = sCmd.match(/^\s*([A-Z_]?[A-Z0-9_]*)\s*(=?)\s*(.*)$/i);
        if (a) {
            if (!a[1]) {
                if (!this.printVariable()) this.println("no variables");
                return true;    // it's not considered an error to print an empty list of variables
            }
            if (!a[2]) {
                return this.printVariable(a[1]);
            }
            if (!a[3]) {
                this.delVariable(a[1]);
                return true;    // it's not considered an error to delete a variable that didn't exist
            }
            var v = this.parseExpression(a[3]);
            if (v !== undefined) {
                this.setVariable(a[1], v);
                return true;
            }
            return false;
        }
        this.println("invalid assignment:" + sCmd);
        return false;
    };

    /**
     * doList(sAddr, fPrint)
     *
     * @this {DebuggerPDP11}
     * @param {string} sAddr
     * @param {boolean} [fPrint]
     * @return {string|null}
     */
    DebuggerPDP11.prototype.doList = function(sAddr, fPrint)
    {
        var sSymbol = null;

        var dbgAddr = this.parseAddr(sAddr, true);
        if (dbgAddr) {
            var addr = this.getAddr(dbgAddr);
            var aSymbol = this.findSymbol(dbgAddr, true);
            if (aSymbol.length) {
                var nDelta, sDelta, s;
                if (aSymbol[0]) {
                    sDelta = "";
                    nDelta = dbgAddr.addr - aSymbol[1];
                    if (nDelta) sDelta = " + " + str.toHexWord(nDelta);
                    s = aSymbol[0] + " (" + this.toHexOffset(aSymbol[1]) + ')' + sDelta;
                    if (fPrint) this.println(s);
                    sSymbol = s;
                }
                if (aSymbol.length > 4 && aSymbol[4]) {
                    sDelta = "";
                    nDelta = aSymbol[5] - dbgAddr.addr;
                    if (nDelta) sDelta = " - " + str.toHexWord(nDelta);
                    s = aSymbol[4] + " (" + this.toHexOffset(aSymbol[5]) + ')' + sDelta;
                    if (fPrint) this.println(s);
                    if (!sSymbol) sSymbol = s;
                }
            } else {
                if (fPrint) this.println("no symbols");
            }
        }
        return sSymbol;
    };

    /**
     * doMessages(asArgs)
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs
     */
    DebuggerPDP11.prototype.doMessages = function(asArgs)
    {
        var m;
        var fCriteria = null;
        var sCategory = asArgs[1];
        if (sCategory == '?') sCategory = undefined;

        if (sCategory !== undefined) {
            var bitsMessage = 0;
            if (sCategory == "all") {
                bitsMessage = (0xffffffff|0) & ~(MessagesPDP11.HALT | MessagesPDP11.KEYS | MessagesPDP11.LOG);
                sCategory = null;
            } else if (sCategory == "on") {
                fCriteria = true;
                sCategory = null;
            } else if (sCategory == "off") {
                fCriteria = false;
                sCategory = null;
            } else {
                /*
                 * Internally, we use "key" instead of "keys", since the latter is a method on JavasScript objects,
                 * but externally, we allow the user to specify "keys"; "kbd" is also allowed as shorthand for "keyboard".
                 */
                if (sCategory == "keys") sCategory = "key";
                if (sCategory == "kbd") sCategory = "keyboard";
                for (m in MessagesPDP11.CATEGORIES) {
                    if (sCategory == m) {
                        bitsMessage = MessagesPDP11.CATEGORIES[m];
                        fCriteria = !!(this.bitsMessage & bitsMessage);
                        break;
                    }
                }
                if (!bitsMessage) {
                    this.println("unknown message category: " + sCategory);
                    return;
                }
            }
            if (bitsMessage) {
                if (asArgs[2] == "on") {
                    this.bitsMessage |= bitsMessage;
                    fCriteria = true;
                }
                else if (asArgs[2] == "off") {
                    this.bitsMessage &= ~bitsMessage;
                    fCriteria = false;
                    if (bitsMessage == MessagesPDP11.BUFFER) {
                        for (var i = 0; i < this.aMessageBuffer.length; i++) {
                            this.println(this.aMessageBuffer[i]);
                        }
                        this.aMessageBuffer = [];
                    }
                }
            }
        }

        /*
         * Display those message categories that match the current criteria (on or off)
         */
        var n = 0;
        var sCategories = "";
        for (m in MessagesPDP11.CATEGORIES) {
            if (!sCategory || sCategory == m) {
                var bitMessage = MessagesPDP11.CATEGORIES[m];
                var fEnabled = !!(this.bitsMessage & bitMessage);
                if (fCriteria !== null && fCriteria != fEnabled) continue;
                if (sCategories) sCategories += ',';
                if (!(++n % 10)) sCategories += "\n\t";     // jshint ignore:line
                /*
                 * Internally, we use "key" instead of "keys", since the latter is a method on JavasScript objects,
                 * but externally, we allow the user to specify "keys".
                 */
                if (m == "key") m = "keys";
                sCategories += m;
            }
        }

        if (sCategory === undefined) {
            this.println("message commands:\n\tm [category] [on|off]\tturn categories on/off");
        }

        this.println((fCriteria !== null? (fCriteria? "messages on:  " : "messages off: ") : "message categories:\n\t") + (sCategories || "none"));

        this.historyInit();     // call this just in case MessagesPDP11.INT was turned on
    };

    /**
     * doOptions(asArgs)
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs
     */
    DebuggerPDP11.prototype.doOptions = function(asArgs)
    {
        switch (asArgs[1]) {
        case "cs":
            var nCycles;
            if (asArgs[3] !== undefined) nCycles = +asArgs[3];          // warning: decimal instead of hex conversion
            switch (asArgs[2]) {
                case "int":
                    this.cpu.nCyclesChecksumInterval = nCycles;
                    break;
                case "start":
                    this.cpu.nCyclesChecksumStart = nCycles;
                    break;
                case "stop":
                    this.cpu.nCyclesChecksumStop = nCycles;
                    break;
                default:
                    this.println("unknown cs option");
                    return;
            }
            if (nCycles !== undefined) {
                this.cpu.resetChecksum();
            }
            this.println("checksums " + (this.cpu.flags.checksum? "enabled" : "disabled"));
            return;

        case "sp":
            if (asArgs[2] !== undefined) {
                if (!this.cpu.setSpeed(+asArgs[2])) {
                    this.println("warning: using 1x multiplier, previous target not reached");
                }
            }
            this.println("target speed: " + this.cpu.getSpeedTarget() + " (" + this.cpu.getSpeed() + "x)");
            return;

        case "?":
            this.println("debugger options:");
            this.println("\tcs int #\tset checksum cycle interval to #");
            this.println("\tcs start #\tset checksum cycle start count to #");
            this.println("\tcs stop #\tset checksum cycle stop count to #");
            this.println("\tsp #\t\tset speed multiplier to #");
            break;

        default:
            if (asArgs[1]) {
                this.println("unknown option: " + asArgs[1]);
                return;
            }
            break;
        }
    };

    /**
     * doRegisters(asArgs, fInstruction)
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} [asArgs]
     * @param {boolean} [fInstruction] (true to include the current instruction; default is true)
     */
    DebuggerPDP11.prototype.doRegisters = function(asArgs, fInstruction)
    {
        if (asArgs && asArgs[1] == '?') {
            this.println("register commands:");
            this.println("\tr\tdump registers");
            this.println("\trx [#]\tset flag or register x to [#]");
            return;
        }

        var cpu = this.cpu;
        if (fInstruction == null) fInstruction = true;

        if (asArgs != null && asArgs.length > 1) {
            var sReg = asArgs[1];
            var sValue = null;
            var i = sReg.indexOf('=');
            if (i > 0) {
                sValue = sReg.substr(i + 1);
                sReg = sReg.substr(0, i);
            }
            else if (asArgs.length > 2) {
                sValue = asArgs[2];
            }
            else {
                this.println("missing value for " + asArgs[1]);
                return;
            }

            var fValid = false;
            var w = this.parseExpression(sValue);

            if (w !== undefined) {
                fValid = true;
                var sRegMatch = sReg.toUpperCase();
                switch (sRegMatch) {
                case "PC":
                    cpu.setPC(w);
                    this.dbgAddrNextCode = this.newAddr(cpu.getPC());
                    break;
                case "CF":
                    if (w) cpu.setCF(); else cpu.clearCF();
                    break;
                case "ZF":
                    if (w) cpu.setZF(); else cpu.clearZF();
                    break;
                case "SF":
                    if (w) cpu.setSF(); else cpu.clearSF();
                    break;
                default:
                    this.println("unknown register: " + sReg);
                    return;
                }
            }
            if (!fValid) {
                this.println("invalid value: " + sValue);
                return;
            }
            cpu.updateCPU();
            this.println("updated registers:");
        }

        this.println(this.getRegDump());

        if (fInstruction) {
            this.dbgAddrNextCode = this.newAddr(cpu.getPC());
            this.doUnassemble(this.toHexAddr(this.dbgAddrNextCode));
        }
    };

    /**
     * doRun(sCmd, sAddr, sOptions, fQuiet)
     *
     * @this {DebuggerPDP11}
     * @param {string} sCmd
     * @param {string|undefined} [sAddr]
     * @param {string} [sOptions] (the rest of the breakpoint command-line)
     * @param {boolean} [fQuiet]
     */
    DebuggerPDP11.prototype.doRun = function(sCmd, sAddr, sOptions, fQuiet)
    {
        if (sCmd == "gt") {
            this.fIgnoreNextCheckFault = true;
        }
        if (sAddr !== undefined) {
            var dbgAddr = this.parseAddr(sAddr, true);
            if (!dbgAddr) return;
            this.parseAddrOptions(dbgAddr, sOptions);
            this.setTempBreakpoint(dbgAddr);
        }
        if (!this.runCPU(true)) {
            if (!fQuiet) this.println("cpu busy or unavailable, run command ignored");
        }
    };

    /**
     * doPrint(sCmd)
     *
     * NOTE: If the string to print is a quoted string, then we run it through replaceRegs(), so that
     * you can take advantage of all the special replacement options used for software interrupt logging.
     *
     * @this {DebuggerPDP11}
     * @param {string} sCmd
     */
    DebuggerPDP11.prototype.doPrint = function(sCmd)
    {
        sCmd = str.trim(sCmd);
        var a = sCmd.match(/^(['"])(.*?)\1$/);
        if (!a) {
            this.parseExpression(sCmd, true);
        } else {
            this.println(this.replaceRegs(a[2]));
        }
    };

    /**
     * doStep(sCmd)
     *
     * @this {DebuggerPDP11}
     * @param {string} [sCmd] "p" or "pr"
     */
    DebuggerPDP11.prototype.doStep = function(sCmd)
    {
        var fCallStep = true;
        var fRegs = (sCmd == "pr"? 1 : 0);
        /*
         * Set up the value for this.nStep (ie, 1 or 2) depending on whether the user wants
         * a subsequent register dump ("pr") or not ("p").
         */
        var nStep = 1 + fRegs;
        if (!this.nStep) {
            var dbgAddr = this.newAddr(this.cpu.getPC());
            var bOpcode = this.getByte(dbgAddr);

            /*
            switch (bOpcode) {
            case PDP11.OPCODE.CALL:
                if (fCallStep) {
                    this.nStep = nStep;
                    this.incAddr(dbgAddr, 3);
                }
                break;
            default:
                break;
            }
            */

            if (this.nStep) {
                this.setTempBreakpoint(dbgAddr);
                if (!this.runCPU()) {
                    if (this.cmp) this.cmp.updateFocus();
                    this.nStep = 0;
                }
                /*
                 * A successful run will ultimately call stop(), which will in turn call clearTempBreakpoint(),
                 * which will clear nStep, so there's your assurance that nStep will be reset.  Now we may have
                 * stopped for reasons unrelated to the temporary breakpoint, but that's OK.
                 */
            } else {
                this.doTrace(fRegs? "tr" : "t");
            }
        } else {
            this.println("step in progress");
        }
    };

    /**
     * getCall(dbgAddr)
     *
     * Given a possible return address (typically from the stack), look for a matching CALL (or INT) that
     * immediately precedes that address.
     *
     * @this {DebuggerPDP11}
     * @param {DbgAddrPDP11} dbgAddr
     * @return {string|null} CALL instruction at or near dbgAddr, or null if none
     */
    DebuggerPDP11.prototype.getCall = function(dbgAddr)
    {
        var sCall = null;
        var addr = dbgAddr.addr;
        var addrOrig = addr;
        for (var n = 1; n <= 6 && !!addr; n++) {
            if (n > 2) {
                dbgAddr.addr = addr;
                var s = this.getInstruction(dbgAddr);
                if (s.indexOf("CALL") >= 0) {
                    /*
                     * Verify that the length of this CALL (or INT), when added to the address of the CALL (or INT),
                     * matches the original return address.  We do this by getting the string index of the opcode bytes,
                     * subtracting that from the string index of the next space, and dividing that difference by two,
                     * to yield the length of the CALL (or INT) instruction, in bytes.
                     */
                    var i = s.indexOf(' ');
                    var j = s.indexOf(' ', i+1);
                    if (addr + (j - i - 1)/2 == addrOrig) {
                        sCall = s;
                        break;
                    }
                }
            }
            addr--;
        }
        dbgAddr.addr = addrOrig;
        return sCall;
    };

    /**
     * doStackTrace(sCmd, sAddr)
     *
     * Use "k" for a normal stack trace and "ks" for a stack trace with symbolic info.
     *
     * @this {DebuggerPDP11}
     * @param {string} [sCmd]
     * @param {string} [sAddr] (not used yet)
     */
    DebuggerPDP11.prototype.doStackTrace = function(sCmd, sAddr)
    {
        if (sAddr == '?') {
            this.println("stack trace commands:");
            this.println("\tk\tshow frame addresses");
            this.println("\tks\tshow symbol information");
            return;
        }

        var nFrames = 10, cFrames = 0;
        var dbgAddrCall = this.newAddr();
        var dbgAddrStack = this.newAddr(this.cpu.getSP());
        this.println("stack trace for " + this.toHexAddr(dbgAddrStack));

        while (cFrames < nFrames) {
            var sCall = null, sCallPrev = null, cTests = 256;
            while ((dbgAddrStack.addr >>> 0) < 0x10000) {
                dbgAddrCall.addr = this.getWord(dbgAddrStack, true);
                /*
                 * Because we're using the auto-increment feature of getWord(), and because that will automatically
                 * wrap the offset around the end of the segment, we must also check the addr property to detect the wrap.
                 */
                if (dbgAddrStack.addr == null || !cTests--) break;
                sCall = this.getCall(dbgAddrCall);
                if (sCall) break;
            }
            /*
             * The sCallPrev check eliminates duplicate sequential calls, which are usually (but not always)
             * indicative of a false positive, in which case the previous call is probably bogus as well, but
             * at least we won't duplicate that mistake.  Of course, there are always exceptions, recursion
             * being one of them, but it's rare that we're debugging recursive code.
             */
            if (!sCall || sCall == sCallPrev) break;
            var sSymbol = null;
            if (sCmd == "ks") {
                var a = sCall.match(/[0-9A-F]+$/);
                if (a) sSymbol = this.doList(a[0]);
            }
            sCall = str.pad(sCall, 50) + "  ;" + (sSymbol || "stack=" + this.toHexAddr(dbgAddrStack)); // + " return=" + this.toHexAddr(dbgAddrCall));
            this.println(sCall);
            sCallPrev = sCall;
            cFrames++;
        }
        if (!cFrames) this.println("no return addresses found");
    };

    /**
     * doTrace(sCmd, sCount)
     *
     * The "t" and "tr" commands interpret the count as a number of instructions, and since
     * we call the Debugger's stepCPU() for each iteration, a single instruction includes
     * any/all prefixes; the CPU's stepCPU() treats prefixes as discrete operations.  The only
     * difference between "t" and "tr": the former displays only the next instruction, while
     * the latter also displays the (updated) registers.
     *
     * The "tc" command interprets the count as a number of cycles rather than instructions,
     * allowing you to quickly execute large chunks of instructions with a single command; it
     * doesn't display anything until the the chunk has finished.
     *
     * However, generally a more useful command is "bn", which allows you to break after some
     * number of instructions have been executed (as opposed to some number of cycles).
     *
     * @this {DebuggerPDP11}
     * @param {string} [sCmd] ("t", "tc", or "tr")
     * @param {string} [sCount] # of instructions to step
     */
    DebuggerPDP11.prototype.doTrace = function(sCmd, sCount)
    {
        var dbg = this;
        var fRegs = (sCmd != "t");
        var nCount = this.parseValue(sCount, null, true) || 1;
        var nCycles = (nCount == 1? 0 : 1);
        if (sCmd == "tc") {
            nCycles = nCount;
            nCount = 1;
        }
        web.onCountRepeat(
            nCount,
            function onCountStep() {
                return dbg.setBusy(true) && dbg.stepCPU(nCycles, fRegs, false);
            },
            function onCountStepComplete() {
                /*
                 * We explicitly called stepCPU() with fUpdateCPU === false, because repeatedly
                 * calling updateCPU() can be very slow, especially when fDisplayLiveRegs is true,
                 * so once the repeat count has been exhausted, we must perform a final updateCPU().
                 */
                dbg.cpu.updateCPU();
                dbg.setBusy(false);
            }
        );
    };

    /**
     * doUnassemble(sAddr, sAddrEnd, n)
     *
     * @this {DebuggerPDP11}
     * @param {string} [sAddr]
     * @param {string} [sAddrEnd]
     * @param {number} [n]
     */
    DebuggerPDP11.prototype.doUnassemble = function(sAddr, sAddrEnd, n)
    {
        var dbgAddr = this.parseAddr(sAddr, true);
        if (!dbgAddr) return;

        if (n === undefined) n = 1;

        var cb = 0x100;
        if (sAddrEnd !== undefined) {

            var dbgAddrEnd = this.parseAddr(sAddrEnd, true);
            if (!dbgAddrEnd || dbgAddrEnd.addr < dbgAddr.addr) return;

            cb = dbgAddrEnd.addr - dbgAddr.addr;
            if (!DEBUG && cb > 0x100) {
                /*
                 * Limiting the amount of disassembled code to 256 bytes in non-DEBUG builds is partly to
                 * prevent the user from wedging the browser by dumping too many lines, but also a recognition
                 * that, in non-DEBUG builds, this.println() keeps print output buffer truncated to 8Kb anyway.
                 */
                this.println("range too large");
                return;
            }
            n = -1;
        }

        var cLines = 0;
        var sInstruction;

        while (cb > 0 && n--) {

            var nSequence = (this.isBusy(false) || this.nStep)? this.nCycles : null;
            var sComment = (nSequence != null? "cycles" : null);
            var aSymbol = this.findSymbol(dbgAddr);

            var addr = dbgAddr.addr;    // we snap dbgAddr.addr *after* calling findSymbol(), which re-evaluates it

            if (aSymbol[0] && n) {
                if (!cLines && n || aSymbol[0].indexOf('+') < 0) {
                    var sLabel = aSymbol[0] + ':';
                    if (aSymbol[2]) sLabel += ' ' + aSymbol[2];
                    this.println(sLabel);
                }
            }

            if (aSymbol[3]) {
                sComment = aSymbol[3];
                nSequence = null;
            }

            sInstruction = this.getInstruction(dbgAddr, sComment, nSequence);

            this.println(sInstruction);
            this.dbgAddrNextCode = dbgAddr;
            cb -= dbgAddr.addr - addr;
            cLines++;
        }
    };

    /**
     * shiftArgs(asArgs)
     *
     * Used with any command (eg, "r") that allows but doesn't require whitespace between command and first argument.
     *
     * @this {DebuggerPDP11}
     * @param {Array.<string>} asArgs
     * @return {Array.<string>}
     */
    DebuggerPDP11.prototype.shiftArgs = function(asArgs)
    {
        if (asArgs && asArgs.length) {
            var s0 = asArgs[0];
            var ch0 = s0.charAt(0);
            for (var i = 1; i < s0.length; i++) {
                var ch = s0.charAt(i);
                if (ch0 == '?' || ch0 == 'r' || ch < 'a' || ch > 'z') {
                    asArgs[0] = s0.substr(i);
                    asArgs.unshift(s0.substr(0, i));
                    break;
                }
            }
        }
        return asArgs;
    };

    /**
     * doCommand(sCmd, fQuiet)
     *
     * @this {DebuggerPDP11}
     * @param {string} sCmd
     * @param {boolean} [fQuiet]
     * @return {boolean} true if command processed, false if unrecognized
     */
    DebuggerPDP11.prototype.doCommand = function(sCmd, fQuiet)
    {
        var result = true;

        try {
            if (!sCmd.length || sCmd == "end") {
                if (this.fAssemble) {
                    this.println("ended assemble at " + this.toHexAddr(this.dbgAddrAssemble));
                    this.dbgAddrNextCode = this.dbgAddrAssemble;
                    this.fAssemble = false;
                }
                sCmd = "";
            }
            else if (!fQuiet) {
                var sPrompt = ">> ";
                this.println(sPrompt + sCmd);
            }

            var ch = sCmd.charAt(0);
            if (ch == '"' || ch == "'") return true;

            /*
             * Zap the previous message buffer to ensure the new command's output is not tossed out as a repeat.
             */
            this.sMessagePrev = null;

            /*
             * I've relaxed the !isBusy() requirement, to maximize our ability to issue Debugger commands externally.
             */
            if (this.isReady() /* && !this.isBusy(true) */ && sCmd.length > 0) {

                if (this.fAssemble) {
                    sCmd = "a " + this.toHexAddr(this.dbgAddrAssemble) + ' ' + sCmd;
                }

                var asArgs = this.shiftArgs(sCmd.replace(/ +/g, ' ').split(' '));

                switch (asArgs[0].charAt(0)) {
                case 'a':
                    this.doAssemble(asArgs);
                    break;
                case 'b':
                    this.doBreak(asArgs[0], asArgs[1], sCmd);
                    break;
                case 'c':
                    this.doClear(asArgs[0]);
                    break;
                case 'd':
                    if (!COMPILED && sCmd == "debug") {
                        window.DEBUG = true;
                        this.println("DEBUG checks on");
                        break;
                    }
                    this.doDump(asArgs);
                    break;
                case 'e':
                    if (asArgs[0] == "else") break;
                    this.doEdit(asArgs);
                    break;
                case 'g':
                    this.doRun(asArgs[0], asArgs[1], sCmd, fQuiet);
                    break;
                case 'h':
                    this.doHalt(fQuiet);
                    break;
                case 'i':
                    if (asArgs[0] == "if") {
                        if (!this.doIf(sCmd.substr(2), fQuiet)) {
                            result = false;
                        }
                    }
                    break;
                case 'k':
                    this.doStackTrace(asArgs[0], asArgs[1]);
                    break;
                case 'l':
                    if (asArgs[0] == "ln") {
                        this.doList(asArgs[1], true);
                        break;
                    }
                    break;
                case 'm':
                    this.doMessages(asArgs);
                    break;
                case 'p':
                    if (asArgs[0] == "print") {
                        this.doPrint(sCmd.substr(5));
                        break;
                    }
                    this.doStep(asArgs[0]);
                    break;
                case 'r':
                    if (sCmd == "reset") {
                        if (this.cmp) this.cmp.reset();
                        break;
                    }
                    this.doRegisters(asArgs);
                    break;
                case 's':
                    this.doOptions(asArgs);
                    break;
                case 't':
                    this.doTrace(asArgs[0], asArgs[1]);
                    break;
                case 'u':
                    this.doUnassemble(asArgs[1], asArgs[2], 8);
                    break;
                case 'v':
                    if (asArgs[0] == "var") {
                        if (!this.doVar(sCmd.substr(3))) {
                            result = false;
                        }
                        break;
                    }
                    this.println((PDP11.APPNAME || "PDP11") + " version " + (XMLVERSION || PDP11.APPVERSION) + " (" + this.cpu.model + (PDP11.COMPILED? ",RELEASE" : (PDP11.DEBUG? ",DEBUG" : ",NODEBUG")) + (PDP11.TYPEDARRAYS? ",TYPEDARRAYS" : (PDP11.BYTEARRAYS? ",BYTEARRAYS" : ",LONGARRAYS")) + ')');
                    this.println(web.getUserAgent());
                    break;
                case '?':
                    if (asArgs[1]) {
                        this.doPrint(sCmd.substr(1));
                        break;
                    }
                    this.doHelp();
                    break;
                case 'n':
                    if (!COMPILED && sCmd == "nodebug") {
                        window.DEBUG = false;
                        this.println("DEBUG checks off");
                        break;
                    }
                    if (this.doInfo(asArgs)) break;
                    /* falls through */
                default:
                    this.println("unknown command: " + sCmd);
                    result = false;
                    break;
                }
            }
        } catch(e) {
            this.println("debugger error: " + (e.stack || e.message));
            result = false;
        }
        return result;
    };

    /**
     * doCommands(sCmds, fSave)
     *
     * @this {DebuggerPDP11}
     * @param {string} sCmds
     * @param {boolean} [fSave]
     * @return {boolean} true if all commands processed, false if not
     */
    DebuggerPDP11.prototype.doCommands = function(sCmds, fSave)
    {
        var a = this.parseCommand(sCmds, fSave);
        for (var s in a) {
            if (!this.doCommand(a[s])) return false;
        }
        return true;
    };

    /**
     * DebuggerPDP11.init()
     *
     * This function operates on every HTML element of class "debugger", extracting the
     * JSON-encoded parameters for the Debugger constructor from the element's "data-value"
     * attribute, invoking the constructor to create a Debugger component, and then binding
     * any associated HTML controls to the new component.
     */
    DebuggerPDP11.init = function()
    {
        var aeDbg = Component.getElementsByClass(document, PDP11.APPCLASS, "debugger");
        for (var iDbg = 0; iDbg < aeDbg.length; iDbg++) {
            var eDbg = aeDbg[iDbg];
            var parmsDbg = Component.getComponentParms(eDbg);
            var dbg = new DebuggerPDP11(parmsDbg);
            Component.bindComponentControls(dbg, eDbg, PDP11.APPCLASS);
        }
    };

    /*
     * Initialize every Debugger module on the page (as IF there's ever going to be more than one ;-))
     */
    web.onInit(DebuggerPDP11.init);

}   // endif DEBUGGER

if (NODE) module.exports = DebuggerPDP11;