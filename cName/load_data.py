#!/usr/bin/env python
# encoding: utf-8

"""
根据 gb2312.txt 和 data/ 生成 python 对象
"""

import string, os.path

def load():
    en = list(': \n')
    en.extend(string.ascii_letters)
    en.extend(string.digits)
    r = {}
    if not os.path.exists('data'):
        os.mkdir('data')
    for line in open("gb2312.txt"):
        for char in unicode(line, 'utf8'):
            if char not in en:
                r[char] = do(char)
    return r

runpath = os.path.dirname(os.path.abspath(__file__))
def do(char):
    wiki = os.path.join(runpath, 'data', u'%s.wiki' % char)
    wiki = open(wiki)
    for line in wiki:
        line = unicode(line, 'utf8')
        if u'总笔画' in line:
            return [
                line.split(',')[0].split(':')[1],
                int(line.split(',')[1].split(':')[1]),
                int(line.split(',')[2].split(':')[1])
                ]
    print 'FAIL: ', char
            
if __name__ == '__main__':
    load()
    
