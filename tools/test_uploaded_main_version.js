const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const child = require("child_process");

// Run only the real batch's version-verification block with a compiled fake console executable.
// This never runs Git reset/clean, contacts LDPlayer/ADB, uploads data or requests compilation.
assert.equal(process.platform, "win32", "Windows CMD/PowerShell validation required");
const repoTools = __dirname;
const batch = fs.readFileSync(path.join(repoTools, "03_main_운영반영.bat"), "utf8");
const start = batch.indexOf("echo [VERIFY] Uploaded HoiBotVersion:");
const end = batch.indexOf("echo [5/5]", start);
assert(start >= 0 && end > start);
const actualBlock = batch.slice(start, end);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hoibot-upload-verify-"));
let groups = 0;
try {
    const helper = path.join(temp, "verify_uploaded_main_version.ps1");
    fs.copyFileSync(path.join(repoTools, "verify_uploaded_main_version.ps1"), helper);
    const mockSource = path.join(temp, "MockVersionConsole.cs");
    const mockExe = path.join(temp, "mock-console.exe");
    fs.writeFileSync(mockSource, `using System;using System.Text;
public class MockVersionConsole {
 public static void Main(string[] args) {
  Console.OutputEncoding=new UTF8Encoding(false);
  string command=string.Join(" ",args);
  if(!command.Contains("grep -n '^const HoiBotVersion ='")){Console.WriteLine("MOCK: wrong grep pattern");Environment.Exit(99);}
  Console.Write(Environment.GetEnvironmentVariable("HOIBOT_TEST_VERSION_OUTPUT")??"");
  Environment.Exit(int.Parse(Environment.GetEnvironmentVariable("HOIBOT_TEST_VERSION_EXIT")??"0"));
 }
}`, "utf8");
    const compile = path.join(temp, "compile-mock.ps1");
    fs.writeFileSync(compile, "param([string]$Source,[string]$Output)\r\n$ErrorActionPreference='Stop'\r\nAdd-Type -Path $Source -OutputAssembly $Output -OutputType ConsoleApplication\r\n", "utf8");
    const built = child.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", compile, "-Source", mockSource, "-Output", mockExe], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const local = path.join(temp, "source with space.js");
    const remoteLog = path.join(temp, "remote version.log");
    const localText = 'const HoiBotVersion = "2.629"; // 수정 시 0.001 증가\r\nvar memberStorageErrorText="error";\r\nconsole.log("ver_"+HoiBotVersion);\r\n';
    fs.writeFileSync(local, localText, "utf8");
    function run(name, mode, output, exitCode, expected) {
        const wrapper = path.join(temp, "verify-only.bat");
        fs.writeFileSync(wrapper, ["@echo off", "chcp 65001 >nul", "setlocal EnableExtensions EnableDelayedExpansion",
            `set "USE_DIRECT_ADB=${mode}"`, `set "ADB_EXE=${mockExe}"`, `set "LD_CONSOLE_EXE=${mockExe}"`,
            "set TARGET_ADB_DEVICE=fake-only", "set TARGET_LD_INDEX=123", "set TARGET_FILE=/synthetic-only/main.js",
            `set "SOURCE_FILE=${local}"`, `set "DEPLOY_LOG=${remoteLog}"`, actualBlock,
            "exit /b 0", ":FAIL_REMOTE_VERIFY", "echo MOCK_VERIFY_FAILED", "exit /b 22"].join("\r\n"), "utf8");
        const result = child.spawnSync("cmd.exe", ["/d", "/c", wrapper], { cwd: temp, encoding: "utf8",
            env: { ...process.env, HOIBOT_TEST_VERSION_OUTPUT: output, HOIBOT_TEST_VERSION_EXIT: String(exitCode) } });
        assert.equal(result.status, expected ? 0 : 22, name + "\n" + result.stdout + result.stderr);
        if (expected) {
            const expectedVersion = /^const HoiBotVersion\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(local, "utf8"))[1];
            assert(result.stdout.includes("Uploaded version matches local source: ver_" + expectedVersion));
        }
        console.log("PASS " + (++groups) + ": " + name);
    }
    for (const mode of ["1", "0"]) {
        const label = mode === "1" ? "direct fake ADB" : "fake LD console";
        run(label + " correct declared version", mode, '3:const HoiBotVersion = "2.629"; // 수정 시 0.001 증가\r\n', 0, true);
        run(label + " Android repeated CR line ending", mode, '3:const HoiBotVersion = "2.629"; // 수정 시 0.001 증가\r\r\n', 0, true);
        run(label + " CR only line ending", mode, '3:const HoiBotVersion = "2.629";\r', 0, true);
        run(label + " unterminated line", mode, '3:const HoiBotVersion = "2.629";', 0, true);
        run(label + " error words in declaration comment accepted", mode, '3:const HoiBotVersion = "2.629"; // error failed not found\r\n', 0, true);
        run(label + " no line number accepted", mode, 'const HoiBotVersion = "2.629";\n', 0, true);
        run(label + " wrong uploaded version rejected", mode, '3:const HoiBotVersion = "2.628";\r\n', 0, false);
        run(label + " wrong version with Android line ending rejected", mode, '3:const HoiBotVersion = "2.628";\r\r\n', 0, false);
        run(label + " empty result rejected", mode, '', 0, false);
        run(label + " source references do not prove version", mode, '31566:replier.reply("ver_"+HoiBotVersion+memberStorageErrorText);\r\n', 0, false);
        run(label + " duplicate declarations rejected", mode, '3:const HoiBotVersion = "2.629";\n4:const HoiBotVersion = "2.629";\n', 0, false);
        run(label + " transport failure retains exit code through type", mode, '3:const HoiBotVersion = "2.629";\n', 1, false);
        run(label + " error mixed with version rejected", mode, '3:const HoiBotVersion = "2.629";\nadb: error: transport closed\n', 0, false);
        run(label + " Android line ending with error rejected", mode, '3:const HoiBotVersion = "2.629";\r\r\nadb: error: transport closed\r\r\n', 0, false);
    }
    fs.writeFileSync(local, 'var HoiBotVersion="2.629";\n', "utf8");
    run("invalid local declaration rejected", "1", '3:const HoiBotVersion = "2.629";\n', 0, false);
    fs.writeFileSync(local, localText + 'const HoiBotVersion = "2.629";\n', "utf8");
    run("ambiguous local declaration rejected", "1", '3:const HoiBotVersion = "2.629";\n', 0, false);
    const actualSource = fs.readFileSync(path.join(repoTools, "..", "main.js"), "utf8");
    const actualDeclaration = /^const HoiBotVersion[^\r\n]+/m.exec(actualSource)[0];
    fs.writeFileSync(local, actualSource, "utf8");
    for (const mode of ["1", "0"]) run("current main.js source with Android line ending mode " + mode, mode, "3:" + actualDeclaration + "\r\r\n", 0, true);
    console.log("PASS: " + groups + " upload version verification groups; fake executables only");
} finally {
    const resolved = fs.realpathSync(temp), parent = fs.realpathSync(os.tmpdir());
    assert(resolved.startsWith(parent + path.sep) && path.basename(resolved).startsWith("hoibot-upload-verify-"));
    fs.rmSync(resolved, { recursive: true, force: true });
}
