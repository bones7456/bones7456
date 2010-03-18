#!/usr/bin/env python
# encoding: utf-8

"""
根据 gb2312.txt 通过查询龙维基（longwiki.net）得到所有汉字的信息。
"""

import string, urllib, re, os, time, random, urllib2

reg = re.compile(r'<textarea id="wpTextbox1" name="wpTextbox1" cols="80" rows="25" readonly="readonly">(.*)</textarea>', re.S)

#proxy_support = urllib2.ProxyHandler({'http':'http://127.0.0.1:7777'})
#opener = urllib2.build_opener(proxy_support, urllib2.HTTPHandler)
#urllib2.install_opener(opener)
un = []
def do(c):
    #url = 'http://www.zdic.net/zd/zi/' + 
    #    urllib.quote(c.encode('utf8')).replace('%', 'zdic') + '.htm'
    f = 'data/%s.wiki'%c
    if os.path.exists(f):
        print 'skip ', c
        return 'skiped'
    print 'deal ', c
    url = 'http://longwiki.net/index.php?title='+c.encode('utf8')+'&action=edit'
#    req = urllib2.Request(url = url, headers = {
#        'User-Agent':'Mozilla/5.0 (Windows; U; Windows NT 6.1; en-US; rv:1.9.1.6) Gecko/20091201 Firefox/3.5.6',
#        'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
#        'Accept-Encoding':'gzip,deflate',
#        'Referer':'http://longwiki.net/%E9%A6%96%E9%A1%B5'})
#    html = urllib2.urlopen(req).read()
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

