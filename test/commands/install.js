/**
 * Copyright (c) 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

import * as reporters from "kreporters";
import * as constants from "../../src/constants.js";
import { default as Lockfile, parse } from "../../src/lockfile/index.js";
import { Install } from "../../src/cli/commands/install.js";
import { run as uninstall } from "../../src/cli/commands/uninstall.js";
import Config from "../../src/config.js";
import * as fs from "../../src/util/fs.js";
import assert from "assert";

let test = require("ava");
let path = require("path");

let fixturesLoc = path.join(__dirname, "..", "fixtures", "install");

async function clean(cwd, removeLock) {
  await fs.unlink(path.join(cwd, constants.MODULE_CACHE_DIRECTORY));
  await fs.unlink(path.join(cwd, "node_modules"));
  if (removeLock) await fs.unlink(path.join(cwd, constants.LOCKFILE_FILENAME));
}

async function createLockfile(dir, strict, save) {
  let lockfileLoc = path.join(dir, constants.LOCKFILE_FILENAME);
  let lockfile;

  if (await fs.exists(lockfileLoc)) {
    let rawLockfile = await fs.readFile(lockfileLoc);
    lockfile = parse(rawLockfile);
  }

  return new Lockfile(lockfile, strict, save);
}

async function run(flags, args, name, checkInstalled, beforeInstall) {
  let reporter = new reporters.NoopReporter;

  let cwd = path.join(fixturesLoc, name);

  if (beforeInstall) {
    await beforeInstall(cwd);
  }

  // remove the lockfile if we create one and it didn't exist before
  let removeLock = !(await fs.exists(path.join(cwd, constants.LOCKFILE_FILENAME)));
  let lockfile = await createLockfile(cwd, flags.strict, flags.save);

  // clean up if we weren't successful last time
  await clean(cwd);

  // create directories
  await fs.mkdirp(path.join(cwd, constants.MODULE_CACHE_DIRECTORY));
  await fs.mkdirp(path.join(cwd, "node_modules"));

  let config = new Config(reporter, { cwd });
  await config.init();

  let install = new Install("install", flags, args, config, reporter, lockfile);
  await install.init();

  if (checkInstalled) {
    await checkInstalled(cwd);
  }

  // clean up
  await clean(cwd, removeLock);
}

test("root install from shrinkwrap", () => {
  return run({}, [], "root-install-with-lockfile");
});

test("root install with optional deps", () => {
  return run({}, [], "root-install-with-optional-dependency");
});

test("install with arg that has install scripts", () => {
  return run({}, ["fsevents"], "install-with-arg-and-install-scripts");
});

test("install with arg", () => {
  return run({}, ["is-online"], "install-with-arg");
});

test("install with arg that has binaries", () => {
  return run({}, ["react-native-cli"], "install-with-arg-and-bin");
});

test("install with --save and offline mirror", () => {
  let mirrorPath = "mirror-for-offline";
  return run({save: true}, ["is-array@1.0.1"], "install-with-save-offline-mirror", async (cwd) => {

    let allFiles = await fs.walk(cwd);

    assert(allFiles.findIndex((file) => {
      return file.relative === `${mirrorPath}/is-array-1.0.1.tgz`;
    }) !== -1);

    let rawLockfile = await fs.readFile(path.join(cwd, constants.LOCKFILE_FILENAME));
    let lockfile = parse(rawLockfile);
    assert.equal(lockfile["is-array@1.0.1"]["resolved"],
      "is-array-1.0.1.tgz#e9850cc2cc860c3bc0977e84ccf0dd464584279a");

    await fs.unlink(path.join(cwd, mirrorPath));
    await fs.unlink(path.join(cwd, "package.json"));
    return allFiles;
  });
});

test("install with --save and without offline mirror", () => {
  let mirrorPath = "mirror-for-offline";
  return run({save: true}, ["is-array@1.0.1"], "install-with-save-no-offline-mirror", async (cwd) => {

    let allFiles = await fs.walk(cwd);

    assert(allFiles.findIndex((file) => {
      return file.relative === `${mirrorPath}/is-array-1.0.1.tgz`;
    }) === -1);

    let rawLockfile = await fs.readFile(path.join(cwd, constants.LOCKFILE_FILENAME));
    let lockfile = parse(rawLockfile);
    assert.equal(lockfile["is-array@1.0.1"]["resolved"],
      "https://registry.npmjs.org/is-array/-/is-array-1.0.1.tgz#e9850cc2cc860c3bc0977e84ccf0dd464584279a");

    await fs.unlink(path.join(cwd, mirrorPath));
    await fs.unlink(path.join(cwd, "package.json"));
    return allFiles;
  });
});

test("install from offline mirror", () => {
  return run({}, [], "install-from-offline-mirror", async (cwd) => {

    let allFiles = await fs.walk(cwd);

    assert(allFiles.findIndex((file) => {
      return file.relative === "node_modules/fake-fbkpm-dependency/package.json";
    }) !== -1);

    return allFiles;
  });
});

test("install should dedupe dependencies avoiding conflicts 0", () => {
  // A@2.0.1 -> B@2.0.0
  // B@1.0.0
  // should result in B@2.0.0 not flattened
  return run({}, [], "install-should-dedupe-avoiding-conflicts-0", async (cwd) => {
    let rawDepBPackage = await fs.readFile(path.join(cwd, "node_modules/dep-b/package.json"));
    assert.equal(JSON.parse(rawDepBPackage).version, "1.0.0");

    rawDepBPackage = await fs.readFile(path.join(cwd, "node_modules/dep-a/node_modules/dep-b/package.json"));
    assert.equal(JSON.parse(rawDepBPackage).version, "2.0.0");
  });
});

test("install should dedupe dependencies avoiding conflicts 1", () => {
  // A@2.0.1 -> B@2.0.0
  // should result in B@2.0.0 flattened
  return run({}, [], "install-should-dedupe-avoiding-conflicts-1", async (cwd) => {
    let rawDepBPackage = await fs.readFile(path.join(cwd, "node_modules/dep-b/package.json"));
    assert.equal(JSON.parse(rawDepBPackage).version, "2.0.0");

    rawDepBPackage = await fs.readFile(path.join(cwd, "node_modules/dep-a/package.json"));
    assert.equal(JSON.parse(rawDepBPackage).version, "2.0.1");
  });
});

test("install should dedupe dependencies avoiding conflicts 2", () => {
  // A@2 -> B@2 -> C@2
  //            -> D@1
  // B@1 -> C@1
  // should become
  // A@2 -> B@2
  // D@1
  // B@1 -> C@1
  // C@2

  return run({}, [], "install-should-dedupe-avoiding-conflicts-2", async (cwd) => {
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-a/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-a/node_modules/dep-b/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-c/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-d/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-b/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-b/node_modules/dep-c/package.json"))).version, "1.0.0");
  });
});

test("install should dedupe dependencies avoiding conflicts 3", () => {
  // A@2 -> B@2 -> C@2
  //            -> D@1
  //     -> C@1
  // should become
  // A@2 -> C@1
  // B@2
  // C@2
  // D@1
  return run({}, [], "install-should-dedupe-avoiding-conflicts-3", async (cwd) => {
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-a/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-c/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-d/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-b/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-a/node_modules/dep-c/package.json"))).version, "1.0.0");
  });
});

test("install should dedupe dependencies avoiding conflicts 4", () => {
  // A@2 -> B@2 -> D@1 -> C@2
  //
  //     -> C@1

  // should become

  // A@2 -> C@1
  // C@2
  // B@2
  // D@1
  return run({}, [], "install-should-dedupe-avoiding-conflicts-4", async (cwd) => {
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-a/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-c/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-d/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-b/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-a/node_modules/dep-c/package.json"))).version, "1.0.0");
  });
});

test("install should dedupe dependencies avoiding conflicts 5", () => {
  // A@1 -> B@1
  // C@1 -> D@1 -> A@2 -> B@2

  // should become

  // A@1
  // B@1
  // C@1
  // D@1 -> A@2
  //     -> B@2

  return run({}, [], "install-should-dedupe-avoiding-conflicts-5", async (cwd) => {
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-a/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-b/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-c/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-d/package.json"))).version, "1.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-d/node_modules/dep-a/package.json"))).version, "2.0.0");
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd,
      "node_modules/dep-d/node_modules/dep-b/package.json"))).version, "2.0.0");

  });
});

test("upgrade scenario", () => {
  // left-pad first installed 0.0.9 then updated to 1.1.0
  // files in mirror, fbkpm.lock, package.json and node_modules should reflect that

  let mirrorPath = "mirror-for-offline";

  async function clean(cwd) {
    await fs.unlink(path.join(cwd, mirrorPath));
    await fs.unlink(path.join(cwd, "fbkpm.lock"));
    await fs.unlink(path.join(cwd, "package.json"));
  }

  return run({ save: true }, ["left-pad@0.0.9"], "install-upgrade-scenario", async (cwd) => {
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd, "node_modules/left-pad/package.json"))).version, "0.0.9");
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(cwd, "package.json"))).dependencies, {"left-pad": "0.0.9"});

    let lockFileWritten = await fs.readFile(path.join(cwd, "fbkpm.lock"));
    let lockFileLines = lockFileWritten.split("\n").filter(line => !!line);
    assert.equal(lockFileLines[0], "left-pad@0.0.9:");
    assert.equal(lockFileLines.length, 4);
    assert.notEqual(lockFileLines[3].indexOf("resolved left-pad-0.0.9.tgz"), -1);

    let mirror = await fs.walk(path.join(cwd, mirrorPath));
    assert.equal(mirror.length, 1);
    assert.equal(mirror[0].relative, "left-pad-0.0.9.tgz");

    return run({save: true}, ["left-pad@1.1.0"], "install-upgrade-scenario", async (cwd) => {
      assert.equal(JSON.parse(await fs.readFile(path.join(cwd, "node_modules/left-pad/package.json"))).version, "1.1.0");
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(cwd, "package.json"))).dependencies, {"left-pad": "1.1.0"});

      let lockFileWritten = await fs.readFile(path.join(cwd, "fbkpm.lock"));
      let lockFileLines = lockFileWritten.split("\n").filter(line => !!line);
      assert.equal(lockFileLines[0], "left-pad@1.1.0:");
      assert.equal(lockFileLines.length, 4);
      assert.notEqual(lockFileLines[3].indexOf("resolved left-pad-1.1.0.tgz"), -1);

      let mirror = await fs.walk(path.join(cwd, mirrorPath));
      assert.equal(mirror.length, 2);
      assert.equal(mirror[1].relative, "left-pad-1.1.0.tgz");

      await clean(cwd);
    });
  }, clean);
});

test("downgrade scenario", () => {
  // left-pad first installed 1.1.0 then downgraded to 0.0.9
  // files in mirror, fbkpm.lock, package.json and node_modules should reflect that

  return run({save: true}, ["left-pad@1.1.0"], "install-downgrade-scenario", async (cwd) => {
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd, "node_modules/left-pad/package.json"))).version, "1.1.0");
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(cwd, "package.json"))).dependencies, {"left-pad": "1.1.0"});

    let mirrorPath = "mirror-for-offline";
    let lockFileWritten = await fs.readFile(path.join(cwd, "fbkpm.lock"));
    let lockFileLines = lockFileWritten.split("\n").filter(line => !!line);
    assert.equal(lockFileLines[0], "left-pad@1.1.0:");
    assert.equal(lockFileLines.length, 4);
    assert.notEqual(lockFileLines[3].indexOf("resolved left-pad-1.1.0.tgz"), -1);

    let mirror = await fs.walk(path.join(cwd, mirrorPath));
    assert.equal(mirror.length, 1);
    assert.equal(mirror[0].relative, "left-pad-1.1.0.tgz");

    return run({save: true}, ["left-pad@0.0.9"], "install-downgrade-scenario", async (cwd) => {
      assert.equal(JSON.parse(await fs.readFile(path.join(cwd, "node_modules/left-pad/package.json"))).version, "0.0.9");
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(cwd, "package.json"))).dependencies, {"left-pad": "0.0.9"});

      let lockFileWritten = await fs.readFile(path.join(cwd, "fbkpm.lock"));
      let lockFileLines = lockFileWritten.split("\n").filter(line => !!line);
      assert.equal(lockFileLines[0], "left-pad@0.0.9:");
      assert.equal(lockFileLines.length, 4);
      assert.notEqual(lockFileLines[3].indexOf("resolved left-pad-0.0.9.tgz"), -1);

      let mirror = await fs.walk(path.join(cwd, mirrorPath));
      assert.equal(mirror.length, 2);
      assert.equal(mirror[0].relative, "left-pad-0.0.9.tgz");

      await fs.unlink(path.join(cwd, mirrorPath));
      await fs.unlink(path.join(cwd, "fbkpm.lock"));
      await fs.unlink(path.join(cwd, "package.json"));
    });
  });
});

test.skip("uninstall should remove dependency from package.json, fbkpm.lock and node_modules", () => {
  return run({}, [], "uninstall-should-clean", async (cwd) => {
    let mirrorPath = "mirror-for-offline";
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd, "node_modules/dep-a/package.json"))).version, "1.0.0");

    let reporter = new reporters.NoopReporter;
    let config = new Config(reporter, { cwd });
    await config.init();

    await uninstall(config, reporter, {}, ["dep-a"]);
  });
});