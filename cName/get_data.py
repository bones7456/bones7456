#!/usr/bin/env python
# encoding: utf-8

"""
根据 gb2312.txt 通过查询龙维基（longwiki.net）得到所有汉字的信息。
"""

import string, urllib, re, os

reg = re.compile(r'<textarea id="wpTextbox1" name="wpTextbox1" cols="80" rows="25" readonly="readonly">(.*)</textarea>', re.S)

un = []
def do(c):
    f = 'data/%s.wiki' % c
    if os.path.exists(f):
        print 'skip ', c
        return 'skiped'
    print 'deal ', c
    url = 'http://longwiki.net/index.php?title='+c.encode('utf8')+'&action=edit'
    html = urllib.urlopen(url).read()
    #print html
    try:
        data = reg.findall(html)[0]
        if data:
            open(f, 'w').write(data)
    except IndexError:
        un.append(c)
        print c,"!"

if __name__ == '__main__':
    en = list(': \n')
    en.extend(string.ascii_letters)
    en.extend(string.digits)
    if not os.path.exists('data'):
        os.mkdir('data')
    for line in open("gb2312.txt"):
        for char in unicode(line, 'utf8'):
            if char not in en:
                if do(char) != 'skiped':
                    pass
                    #time.sleep(random.uniform(1, 4))
    print ':'.join(un)

