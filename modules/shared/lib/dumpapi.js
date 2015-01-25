/**
 * @fileoverview Disk APIs, as defined by diskdump.js and consumed by disk.js
 * @author <a href="mailto:Jeff@pcjs.org">Jeff Parsons</a>
 * @version 1.0
 * Created 2014-May-08
 *
 * Copyright © 2012-2015 Jeff Parsons <Jeff@pcjs.org>
 *
 * This file is part of the JavaScript Machines Project (aka JSMachines) at <http://jsmachines.net/>
 * and <http://pcjs.org/>.
 *
 * JSMachines is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * JSMachines is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
 * even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with JSMachines.
 * If not, see <http://www.gnu.org/licenses/gpl.html>.
 *
 * You are required to include the above copyright notice in every source code file of every
 * copy or modified version of this work, and to display that copyright notice on every screen
 * that loads or runs any version of this software (see Computer.sCopyright).
 *
 * Some JSMachines files also attempt to load external resource files, such as character-image files,
 * ROM files, and disk image files. Those external resource files are not considered part of the
 * JSMachines Project for purposes of the GNU General Public License, and the author does not claim
 * any copyright as to their contents.
 */

"use strict";

/*
 * Our "DiskDump API", such as it was, used to look like:
 *
 *      http://jsmachines.net/bin/convdisk.php?disk=/disks/pc/dos/ibm/2.00/PCDOS200-DISK1.json&format=img
 *
 * To make it (a bit) more "REST-like", the above request now looks like:
 *
 *      http://www.pcjs.org/api/v1/dump?disk=/disks/pc/dos/ibm/2.00/PCDOS200-DISK1.json&format=img
 *
 * Similarly, our "FileDump API" used to look like:
 *
 *      http://jsmachines.net/bin/convrom.php?rom=/devices/pc/bios/5150/1981-04-24.rom&format=json
 *
 * and that request now looks like:
 *
 *      http://www.pcjs.org/api/v1/dump?file=/devices/pc/bios/5150/1981-04-24.rom&format=json
 *
 * I don't think it makes sense to avoid "query" parameters, because blending the path of a disk image with the
 * the rest of the URL would be (a) confusing, and (b) more work to parse.
 */
var DumpAPI = {
    ENDPOINT:       "/api/v1/dump",
    QUERY: {
        DIR:        "dir",      // value is path of a directory (DiskDump only)
        DISK:       "disk",     // value is path of a disk image (DiskDump only)
        FILE:       "file",     // value is path of a ROM image file (FileDump only)
        IMG:        "img",      // alias for DISK
        PATH:       "path",     // value is path of a one or more files (DiskDump only)
        FORMAT:     "format",   // value is one of FORMAT values below
        COMMENTS:   "comments", // value is either "true" or "false"
        DECIMAL:    "decimal",  // value is either "true" to force all numbers to decimal, "false" or undefined otherwise
        MBHD:       "mbhd"      // value is hard disk size in Mb (formerly "mbsize") (DiskDump only)
    },
    FORMAT: {
        JSON:       "json",     // default
        DATA:       "data",     // same as "json", but built without JSON.stringify() (DiskDump only)
        HEX:        "hex",      // deprecated
        BYTES:      "bytes",    // displays data as hex bytes; normally used only when comments are enabled
        IMG:        "img",      // returns the raw disk data (ie, using a Buffer object) (DiskDump only)
        ROM:        "rom"       // returns the raw file data (ie, using a Buffer object) (FileDump only)
    }
};

/*
 * Because we use an overloaded API endpoint (ie, one that's shared with the FileDump module), we must
 * also provide a list of commands which, when combined with the endpoint, define a unique request. 
 */
DumpAPI.asDiskCommands = [DumpAPI.QUERY.DIR, DumpAPI.QUERY.DISK, DumpAPI.QUERY.PATH];
DumpAPI.asFileCommands = [DumpAPI.QUERY.FILE];

if (typeof module !== 'undefined') module.exports = DumpAPI;